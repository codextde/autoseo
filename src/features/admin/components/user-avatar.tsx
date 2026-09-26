"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/components/app/user-menu";
import { cn } from "@/lib/utils";

export function UserAvatar({
  name,
  email,
  src,
  size = "default",
  className,
}: {
  name: string | null | undefined;
  email: string;
  src?: string | null;
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  return (
    <Avatar size={size} className={className}>
      {src && <AvatarImage src={src} alt="" />}
      <AvatarFallback className={cn("bg-brand-soft font-semibold text-brand", size === "sm" ? "text-[10px]" : "text-[11px]")}>
        {initials(name, email)}
      </AvatarFallback>
    </Avatar>
  );
}

export function UserCell({
  name,
  email,
  src,
  badges,
}: {
  name: string | null | undefined;
  email: string;
  src?: string | null;
  badges?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <UserAvatar name={name} email={email} src={src} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{name || email.split("@")[0]}</span>
          {badges}
        </div>
        <div className="truncate text-xs text-muted-foreground">{email}</div>
      </div>
    </div>
  );
}
