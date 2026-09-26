"use client";

import Link from "next/link";
import { ChevronDown, LogOut, Settings, ShieldAlert, Users, Wallet, KeyRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { logoutAction } from "@/features/shell/actions";
import { useShell } from "./shell-context";

export function initials(name: string | null | undefined, email: string) {
  const src = (name || email).trim();
  const parts = src.split(/[\s.@_-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function UserMenu() {
  const { user } = useShell();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="ml-1 flex items-center gap-2 rounded-lg px-1.5 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar className="size-7">
          {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
          <AvatarFallback className="bg-brand-soft text-[11px] font-semibold text-brand">
            {initials(user.name, user.email)}
          </AvatarFallback>
        </Avatar>
        <span className="hidden max-w-40 flex-col leading-tight xl:flex">
          <span className="truncate text-sm font-medium">{user.name || user.email.split("@")[0]}</span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted-foreground xl:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{user.name || user.email}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/account">
            <Settings /> Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/api">
            <KeyRound /> API & MCP
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/usage">
            <Wallet /> Usage
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/workspace">
            <Users /> Workspace
          </Link>
        </DropdownMenuItem>
        {user.isInstanceAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <ShieldAlert /> Admin
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <form action={logoutAction}>
          <DropdownMenuItem asChild variant="destructive">
            <button type="submit" className="w-full">
              <LogOut /> Log out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
