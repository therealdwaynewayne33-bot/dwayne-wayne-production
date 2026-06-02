function envHost(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/$/, "") : null;
}

export function resolvePublicDomain(): string | null {
  return (
    envHost(process.env.REPLIT_DEV_DOMAIN) ??
    envHost(process.env.REPLIT_DOMAINS?.split(",")[0]) ??
    envHost(process.env.PUBLIC_DOMAIN) ??
    envHost(process.env.DOMAIN) ??
    envHost(process.env.SELFHOSTED_URL) ??
    null
  );
}
