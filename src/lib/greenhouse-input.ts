const GREENHOUSE_BOARD_HOSTS = new Set(["boards.greenhouse.io", "job-boards.greenhouse.io"]);

export function parseGreenhouseBoardReference(value: string): string | null {
  const input = value.trim();
  if (!input) return null;

  let board = input;
  if (!/^[a-z0-9-]+$/i.test(input)) {
    try {
      const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`);
      if (!GREENHOUSE_BOARD_HOSTS.has(url.hostname.toLowerCase())) return null;
      board = url.searchParams.get("for") ?? url.pathname.split("/").filter(Boolean)[0] ?? "";
      if (board === "embed") board = url.searchParams.get("for") ?? "";
    } catch {
      return null;
    }
  }

  const normalized = board.toLowerCase();
  return /^[a-z0-9-]{1,80}$/.test(normalized) ? normalized : null;
}
