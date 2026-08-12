"use client";

import { usePathname } from "next/navigation";

/**
 * The only client component in the signed-in shell — it exists purely so the
 * current section can be highlighted, which needs the pathname.
 */
export function NavLinks() {
  const path = usePathname();

  const link = (href: string, label: string) => {
    const active = path === href || path.startsWith(href + "/");
    return (
      <a
        href={href}
        aria-current={active ? "page" : undefined}
        className={`transition-colors ${active ? "text-white" : "text-zinc-500 hover:text-zinc-200"}`}
      >
        {label}
      </a>
    );
  };

  return (
    <>
      {link("/dashboard", "Dashboard")}
      {link("/settings", "Settings")}
    </>
  );
}
