function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function toLocalDayKey(value: Date | number = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
