"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/app/page";
import { initials } from "@/components/app/user-menu";
import { Rows, SettingRow } from "@/features/admin/components/settings-kit";
import { removeAvatarAction, updateProfileAction, uploadAvatarAction } from "../actions";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
const MAX_BYTES = 5 * 1024 * 1024;

export function ProfilePanel({
  user,
}: {
  user: { name: string | null; email: string; avatarUrl: string | null; createdAt: string };
}) {
  const [name, setName] = useState(user.name ?? "");
  const [avatar, setAvatar] = useState(user.avatarUrl);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = name.trim() !== (user.name ?? "").trim();

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPT.split(",").includes(file.type)) return void toast.error("Please choose a PNG, JPG, GIF or WebP image.");
    if (file.size > MAX_BYTES) return void toast.error("The image is larger than 5 MB.");
    const fd = new FormData();
    fd.set("file", file);
    setUploading(true);
    try {
      const res = await uploadAvatarAction(fd);
      if (!res.ok) return void toast.error(res.error);
      setAvatar(res.data.url);
      toast.success("Avatar updated");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Panel title="Profile information" description="How teammates see you across the workspace.">
      <Rows>
        <SettingRow label="Avatar" description="PNG, JPG, GIF or WebP · max 5 MB.">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar className="size-16 ring-4 ring-background">
                {avatar && <AvatarImage src={avatar} alt="" className="object-cover" />}
                <AvatarFallback className="bg-brand-soft text-lg font-semibold text-brand">
                  {initials(name || user.name, user.email)}
                </AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="absolute -right-1 -bottom-1 flex size-7 items-center justify-center rounded-full border bg-background shadow-sm transition hover:bg-muted"
                aria-label="Upload avatar"
              >
                {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                Upload avatar
              </Button>
              {avatar && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={uploading}
                  onClick={async () => {
                    const res = await removeAvatarAction();
                    if (!res.ok) return void toast.error(res.error);
                    setAvatar(null);
                    toast.success("Avatar removed");
                  }}
                >
                  <Trash2 className="size-3.5" /> Remove
                </Button>
              )}
            </div>
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
        </SettingRow>
        <SettingRow label="Full name" htmlFor="profile-name">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              try {
                const res = await updateProfileAction({ name });
                if (!res.ok) return void toast.error(res.error);
                toast.success("Profile updated");
              } finally {
                setSaving(false);
              }
            }}
          >
            <Input
              id="profile-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />
            <Button type="submit" disabled={!dirty || saving || !name.trim()} className="shrink-0">
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Update profile"}
            </Button>
          </form>
        </SettingRow>
        <SettingRow label="Email" description="Your sign-in address. It can't be changed — ask an admin to invite a new address instead.">
          <div className="flex h-8 items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-2.5 text-sm text-muted-foreground">
            <Lock className="size-3.5 shrink-0" />
            <span className="truncate">{user.email}</span>
          </div>
        </SettingRow>
      </Rows>
    </Panel>
  );
}
