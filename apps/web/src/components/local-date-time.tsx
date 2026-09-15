"use client";

import { useEffect, useState } from "react";
import { formatDateTime, formatLocalDateTime } from "../lib/date-time";

type LocalDateTimeProps = {
  value: Date | string;
  className?: string;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function LocalDateTime({ value, className }: LocalDateTimeProps) {
  const iso = toIso(value);
  const [display, setDisplay] = useState(() => formatDateTime(iso));

  useEffect(() => {
    setDisplay(formatLocalDateTime(iso));
  }, [iso]);

  return <time className={className} dateTime={iso}>{display}</time>;
}
