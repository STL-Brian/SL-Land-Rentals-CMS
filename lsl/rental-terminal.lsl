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
key gRegisterRequest;
key gUrlRequest;
string gCallbackURL = "";
integer gCallbackGeneration = 0;
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
    integer remain;
    if (gEndsAt > llGetUnixTime()) {
        remain = gEndsAt - llGetUnixTime();
        text = gRenter + "\n" + (string)(remain / 86400) + "d " + (string)((remain % 86400) / 3600) + "h remaining";
    } else text = "Available now";
    if (gPayPrice > 0) text += "\nL$" + (string)gPayPrice + " / week";
    llSetText(text, <0.45, 0.95, 0.85>, 1.0);
    if (gPayPrice > 0) llSetPayPrice(PAY_HIDE, [gPayPrice, PAY_HIDE, PAY_HIDE, PAY_HIDE]);
    else llSetPayPrice(PAY_HIDE, [PAY_HIDE, PAY_HIDE, PAY_HIDE, PAY_HIDE]);
}
sendPoll() {
    if (gPollRequest != NULL_KEY) return;
    string eventID = "poll-" + (string)llGenerateKey();
    gPollRequest = llHTTPRequest(API_BASE + "/api/terminal/poll?sequence=" + (string)gSequence, signedHeaders(eventID, ""), "");
}
registerCallback() {
    if (gCallbackURL == "" || gRegisterRequest != NULL_KEY) return;
    string body = llList2Json(JSON_OBJECT, ["callbackUrl", gCallbackURL, "generation", gCallbackGeneration]);
    string eventID = "register-" + (string)llGenerateKey();
    gRegisterRequest = llHTTPRequest(API_BASE + "/api/terminal/register", signedHeaders(eventID, body), body);
}
sendPayment(string queueKey, string eventID, string body) {
    key request;
    if (llListFindList(gQueueKeys, [queueKey]) != -1) return;
    request = llHTTPRequest(API_BASE + "/api/terminal/payment", signedHeaders(eventID, body), body);
    gRequestIds += [request];
    gQueueKeys += [queueKey];
}
sendHealthResponse(string checkID) {
    string body = llList2Json(JSON_OBJECT, ["checkId", checkID]);
    string eventID = "health-" + (string)llGenerateKey();
    llHTTPRequest(API_BASE + "/api/terminal/health", signedHeaders(eventID, body), body);
}
retryQueue() {
    list keys;
    integer i;
    string queueKey;
    string packed;
    keys = llLinksetDataFindKeys("^payment_", 0, MAX_QUEUED_PAYMENTS);
    i = 0;
    while (i < llGetListLength(keys)) {
        queueKey = llList2String(keys, i);
        packed = llLinksetDataRead(queueKey);
        if (packed != "") sendPayment(queueKey, llJsonGetValue(packed, ["eventId"]), llJsonGetValue(packed, ["body"]));
        i += 1;
    }
}
callbackResponse(key requestID, integer status, string message) {
    llHTTPResponse(requestID, status, message);
}
handleCallback(key requestID, string body) {
    string signedBody;
    string signature;
    string eventID;
    string kind;
    integer sequence;
    string createdAt;
    string replayKey;
    string payload;
    string display;
    string renter;
    string endsAt;
    // The worker sends {version,signedBody,signature}; only signedBody is authenticated.
    if (llJsonValueType(body, []) != JSON_OBJECT) { callbackResponse(requestID, 400, "invalid callback"); return; }
    if ((integer)llJsonGetValue(body, ["version"]) != 1) { callbackResponse(requestID, 400, "unsupported callback version"); return; }
    signedBody = llJsonGetValue(body, ["signedBody"]);
    signature = llJsonGetValue(body, ["signature"]);
    if (signedBody == JSON_INVALID || signature == JSON_INVALID || llHMAC(TERMINAL_SECRET, signedBody, "sha256") != signature) { callbackResponse(requestID, 401, "invalid callback signature"); return; }
    if (llJsonValueType(signedBody, []) != JSON_OBJECT || (integer)llJsonGetValue(signedBody, ["version"]) != 1) { callbackResponse(requestID, 400, "invalid signed callback"); return; }
    eventID = llJsonGetValue(signedBody, ["eventId"]);
    kind = llJsonGetValue(signedBody, ["kind"]);
    sequence = (integer)llJsonGetValue(signedBody, ["sequence"]);
    createdAt = llJsonGetValue(signedBody, ["createdAt"]);
    if (eventID == JSON_INVALID || kind == JSON_INVALID || sequence < 1 || createdAt == JSON_INVALID || llJsonGetValue(signedBody, ["payload"]) == JSON_INVALID) { callbackResponse(requestID, 400, "missing callback fields"); return; }
    if (sequence <= gSequence) { callbackResponse(requestID, 409, "callback replay or order violation"); return; }
    replayKey = "callback_event_" + eventID;
    if (llLinksetDataRead(replayKey) != "") { callbackResponse(requestID, 409, "callback replay"); return; }
    // Persist the replay marker and sequence before mutating display or acknowledging.
    if (llLinksetDataWrite(replayKey, (string)sequence) != XP_ERROR_NONE || llLinksetDataWrite("callback_sequence", (string)sequence) != XP_ERROR_NONE) { callbackResponse(requestID, 503, "callback state unavailable"); return; }
    payload = llJsonGetValue(signedBody, ["payload"]);
    display = llJsonGetValue(payload, ["display"]);
    if (display != JSON_INVALID && llJsonValueType(display, []) == JSON_OBJECT) {
        renter = llJsonGetValue(display, ["renter"]);
        endsAt = llJsonGetValue(display, ["endsAt"]);
        if (renter == JSON_NULL) gRenter = "Available"; else if (renter != JSON_INVALID) gRenter = renter;
        if (endsAt == JSON_NULL) gEndsAt = 0; else if (endsAt != JSON_INVALID) gEndsAt = (integer)endsAt;
    }
    gSequence = sequence;
    gLastPollSuccess = llGetUnixTime();
    updateDisplay();
    callbackResponse(requestID, 200, "accepted");
}
default {
    state_entry() {
        if (TERMINAL_SECRET == "REPLACE_WITH_PAIRED_PER_OBJECT_SECRET") llOwnerSay("Terminal is not paired. Set the per-object secret.");

        gCallbackGeneration = (integer)llLinksetDataRead("callback_generation");
        gSequence = (integer)llLinksetDataRead("callback_sequence");
        gUrlRequest = llRequestSecureURL();
        llSetTimerEvent(POLL_SECONDS);
        updateDisplay();
        sendPoll();
        retryQueue();
    }
    on_rez(integer start) { llResetScript(); }
    changed(integer change) { if (change & (CHANGED_OWNER | CHANGED_REGION | CHANGED_REGION_START)) llResetScript(); }
    timer() {
        if (gLastPollSuccess == 0 || llGetUnixTime() - gLastPollSuccess > POLL_SECONDS * 2) {
            gPayPrice = 0;
            updateDisplay();
        }
        sendPoll();
        registerCallback();
        retryQueue();
    }
    money(key payer, integer amount) {
        list keys;
        string eventID;
        string body;
        string queueKey;
        integer persisted;
        // SL's money event has no transaction ID. Persist our UUID before HTTPS.
        keys = llLinksetDataFindKeys("^payment_", 0, MAX_QUEUED_PAYMENTS);
        if (llGetListLength(keys) >= MAX_QUEUED_PAYMENTS) {
            llInstantMessage(payer, "Lake Tech Estates could not queue this payment confirmation. Contact estate support with your transaction history.");
            return;
        }
        eventID = (string)llGenerateKey();
        body = llList2Json(JSON_OBJECT, ["amountLinden", amount, "payerAvatarId", (string)payer, "payerName", llKey2Name(payer)]);
        queueKey = "payment_" + eventID;
        persisted = llLinksetDataWrite(queueKey, llList2Json(JSON_OBJECT, ["eventId", eventID, "body", body]));
        if (persisted != XP_ERROR_NONE) {
            llOwnerSay("Lake Tech Estates terminal queue persistence failed; no HTTP confirmation was sent.");
            llInstantMessage(payer, "Lake Tech Estates could not durably queue this payment event. Contact estate support with your transaction history.");
            return;
        }
        sendPayment(queueKey, eventID, body);
        llInstantMessage(payer, "Lake Tech Estates received your L$ event. Confirmation follows server verification.");
    }
    http_request(key requestID, string method, string body) {
        if (method == "URL_REQUEST_GRANTED") {
            gCallbackURL = body;
            gCallbackGeneration += 1;
            llLinksetDataWrite("callback_generation", (string)gCallbackGeneration);
            gRegisterRequest = NULL_KEY;
            registerCallback();
        } else if (method == "URL_REQUEST_DENIED") {
            gCallbackURL = "";
            gRegisterRequest = NULL_KEY;
        } else if (method == "POST") {
            handleCallback(requestID, body);
        } else callbackResponse(requestID, 405, "POST required");
    }
    http_response(key requestID, integer status, list metadata, string body) {
        integer i;
        integer at;
        string renter;
        string ends;
        list events;
        string eventJson;
        string queueKey;
        if (requestID == gPollRequest) {
            gPollRequest = NULL_KEY;
            if (status == 200) {
                gLastPollSuccess = llGetUnixTime();
                gSequence = (integer)llJsonGetValue(body, ["sequence"]);
                renter = llJsonGetValue(body, ["renter"]);
                if (renter == JSON_NULL) gRenter = "Available";
                else gRenter = renter;
                ends = llJsonGetValue(body, ["endsAt"]);
                if (ends == JSON_NULL) gEndsAt = 0;
                else gEndsAt = (integer)ends;
                gPayPrice = (integer)llJsonGetValue(body, ["payPrice"]);
                updateDisplay();
                events = llJson2List(llJsonGetValue(body, ["events"]));
                i = 0;
                while (i < llGetListLength(events)) {
                    eventJson = llList2String(events, i);
                    if (llJsonGetValue(eventJson, ["kind"]) == "HEALTH_CHECK") sendHealthResponse(llJsonGetValue(eventJson, ["payload", "checkId"]));
                    i += 1;
                }
            }
            return;
        }
        if (requestID == gRegisterRequest) {
            gRegisterRequest = NULL_KEY;
            return;
        }
        at = llListFindList(gRequestIds, [requestID]);
        if (at != -1) {
            queueKey = llList2String(gQueueKeys, at);
            if (status >= 200 && status < 300) llLinksetDataDelete(queueKey);
            gRequestIds = llDeleteSubList(gRequestIds, at, at);
            gQueueKeys = llDeleteSubList(gQueueKeys, at, at);
        }
    }
}
