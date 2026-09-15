"use client";

import { useEffect, useState } from "react";
import { formatDate, formatLocalDate } from "../lib/date-time";

type LocalDateProps = {
  value: Date | string;
  className?: string;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function LocalDate({ value, className }: LocalDateProps) {
  const iso = toIso(value);
  const [display, setDisplay] = useState(() => formatDate(iso));

  useEffect(() => {
    setDisplay(formatLocalDate(iso));
  }, [iso]);

  return <time className={className} dateTime={iso}>{display}</time>;
}
