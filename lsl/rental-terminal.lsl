// Lake Tech Estates rental terminal — configure before rez.
// Pairing writes the assigned terminal UUID and secret into these placeholders.
string API_BASE = "https://hermes-dev-2.tallofam.com";
string TERMINAL_SECRET = "REPLACE_WITH_PAIRED_PER_OBJECT_SECRET";
string SHARD = "Second Life";
integer POLL_SECONDS = 30;
integer MAX_QUEUED_PAYMENTS = 32;
integer gSequence = 0;
integer gPayPrice = 0;
string gRenter = "Available";
integer gEndsAt = 0;
integer gLastPollSuccess = 0;
key gPollRequest;
list gRequestIds;
list gQueueKeys;

string randomNonce() { return (string)llGenerateKey(); }
string canonical(string timestamp, string nonce, string eventID, string body) {
    return timestamp + "\n" + nonce + "\n" + eventID + "\n" + llSHA256String(body);
}
list signedHeaders(string eventID, string body) {
    string timestamp = (string)llGetUnixTime();
    string nonce = randomNonce();
    string method = "POST";
    if (body == "") method = "GET";
    // llHMAC returns Base64, matching the server's timing-safe verifier.
    string signature = llHMAC(TERMINAL_SECRET, canonical(timestamp, nonce, eventID, body), "sha256");
    return [HTTP_METHOD, method, HTTP_MIMETYPE, "application/json",
        HTTP_CUSTOM_HEADER, "X-SL-Timestamp", timestamp,
        HTTP_CUSTOM_HEADER, "X-SL-Nonce", nonce,
        HTTP_CUSTOM_HEADER, "X-SL-Event-ID", eventID,
        HTTP_CUSTOM_HEADER, "X-SL-Object-ID", (string)llGetKey(),
        HTTP_CUSTOM_HEADER, "X-SL-Owner-ID", (string)llGetOwner(),
        HTTP_CUSTOM_HEADER, "X-SL-Shard", SHARD,
        HTTP_CUSTOM_HEADER, "X-SL-Signature", signature];
}
updateDisplay() {
    string text;
    if (gEndsAt > llGetUnixTime()) {
        integer remain = gEndsAt - llGetUnixTime();
        text = gRenter + "\n" + (string)(remain / 86400) + "d " + (string)((remain % 86400) / 3600) + "h remaining";
    } else text = "Available now";
    if (gPayPrice > 0) text += "\nL$" + (string)gPayPrice + " / week";
    llSetText(text, <0.45, 0.95, 0.85>, 1.0);
    if (gPayPrice > 0) llSetPayPrice(PAY_HIDE, [gPayPrice, PAY_HIDE, PAY_HIDE, PAY_HIDE]);
    else llSetPayPrice(PAY_HIDE, [PAY_HIDE, PAY_HIDE, PAY_HIDE, PAY_HIDE]);
}
sendPoll() {
    string eventID = "poll-" + (string)llGenerateKey();
    gPollRequest = llHTTPRequest(API_BASE + "/api/terminal/poll?sequence=" + (string)gSequence, signedHeaders(eventID, ""), "");
}
sendPayment(string queueKey, string eventID, string body) {
    if (llListFindList(gQueueKeys, [queueKey]) != -1) return;
    key request = llHTTPRequest(API_BASE + "/api/terminal/payment", signedHeaders(eventID, body), body);
    gRequestIds += [request];
    gQueueKeys += [queueKey];
}
retryQueue() {
    list keys = llLinksetDataFindKeys("^payment_", 0, MAX_QUEUED_PAYMENTS);
    integer i;
    for (i = 0; i < llGetListLength(keys); ++i) {
        string queueKey = llList2String(keys, i);
        string packed = llLinksetDataRead(queueKey);
        if (packed != "") sendPayment(queueKey, llJsonGetValue(packed, ["eventId"]), llJsonGetValue(packed, ["body"]));
    }
}
default {
    state_entry() {
        if (TERMINAL_SECRET == "REPLACE_WITH_PAIRED_PER_OBJECT_SECRET") llOwnerSay("Terminal is not paired. Set the per-object secret.");
        llSetTimerEvent(POLL_SECONDS);
        updateDisplay();
        sendPoll();
        retryQueue();
    }
    on_rez(integer start) { llResetScript(); }
    changed(integer change) { if (change & CHANGED_OWNER) llResetScript(); }
    timer() {
        if (gLastPollSuccess == 0 || llGetUnixTime() - gLastPollSuccess > POLL_SECONDS * 2) {
            gPayPrice = 0;
            updateDisplay();
        }
        sendPoll();
        retryQueue();
    }
    money(key payer, integer amount) {
        // SL's money event has no transaction ID. Persist our UUID before HTTPS.
        list keys = llLinksetDataFindKeys("^payment_", 0, MAX_QUEUED_PAYMENTS);
        if (llGetListLength(keys) >= MAX_QUEUED_PAYMENTS) {
            llInstantMessage(payer, "Lake Tech Estates could not queue this payment confirmation. Contact estate support with your transaction history.");
            return;
        }
        string eventID = (string)llGenerateKey();
        string body = llList2Json(JSON_OBJECT, ["amountLinden", amount, "payerAvatarId", (string)payer, "payerName", llKey2Name(payer)]);
        string queueKey = "payment_" + eventID;
        integer persisted = llLinksetDataWrite(queueKey, llList2Json(JSON_OBJECT, ["eventId", eventID, "body", body]));
        if (persisted != XP_ERROR_NONE) {
            llOwnerSay("Lake Tech Estates terminal queue persistence failed; no HTTP confirmation was sent.");
            llInstantMessage(payer, "Lake Tech Estates could not durably queue this payment event. Contact estate support with your transaction history.");
            return;
        }
        sendPayment(queueKey, eventID, body);
        llInstantMessage(payer, "Lake Tech Estates received your L$ event. Confirmation follows server verification.");
    }
    http_response(key requestID, integer status, list metadata, string body) {
        if (requestID == gPollRequest) {
            if (status == 200) {
                gLastPollSuccess = llGetUnixTime();
                gSequence = (integer)llJsonGetValue(body, ["sequence"]);
                string renter = llJsonGetValue(body, ["renter"]);
                if (renter == JSON_NULL) gRenter = "Available";
                else gRenter = renter;
                string ends = llJsonGetValue(body, ["endsAt"]);
                if (ends == JSON_NULL) gEndsAt = 0;
                else gEndsAt = (integer)ends;
                gPayPrice = (integer)llJsonGetValue(body, ["payPrice"]);
                updateDisplay();
            }
            return;
        }
        integer at = llListFindList(gRequestIds, [requestID]);
        if (at != -1) {
            string queueKey = llList2String(gQueueKeys, at);
            if (status >= 200 && status < 300) llLinksetDataDelete(queueKey);
            gRequestIds = llDeleteSubList(gRequestIds, at, at);
            gQueueKeys = llDeleteSubList(gQueueKeys, at, at);
        }
    }
}
