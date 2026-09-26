"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/app/misc";
import { Panel } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { deleteAssetAction, updateAssetAction } from "../actions";
import type { AssetDetail } from "../types";
import { MarketPicker } from "./market-picker";

export function AssetEditor({ projectId, asset, canEdit }: { projectId: string; asset: AssetDetail["asset"]; canEdit: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(asset.name);
  const [aliases, setAliases] = useState(asset.aliases.join(", "));
  const [ingredient, setIngredient] = useState(asset.activeIngredient ?? "");
  const [description, setDescription] = useState(asset.description ?? "");
  const [markets, setMarkets] = useState(asset.markets);
  const [active, setActive] = useState(asset.status === "active");
  const [pending, start] = useTransition();

  const dirty =
    name !== asset.name ||
    aliases !== asset.aliases.join(", ") ||
    ingredient !== (asset.activeIngredient ?? "") ||
    description !== (asset.description ?? "") ||
    JSON.stringify(markets) !== JSON.stringify(asset.markets) ||
    active !== (asset.status === "active");

  const save = () =>
    start(async () => {
      const res = await updateAssetAction(projectId, asset.id, {
        name,
        aliases: aliases
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
        activeIngredient: ingredient || null,
        description: description || null,
        markets,
        status: active ? "active" : "paused",
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Asset saved");
      router.refresh();
    });

  return (
    <Panel
      title="Asset settings"
      description="Names and markets used to find statements about this asset in AI answers"
      actions={
        canEdit ? (
          <label className="flex items-center gap-2 text-xs font-medium">
            <Switch checked={active} onCheckedChange={setActive} />
            {active ? "Active" : "Paused"}
          </label>
        ) : null
      }
      footer={
        canEdit ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ConfirmButton
              title={`Delete ${asset.name}?`}
              description="The asset, its reference documents and all collected statements and findings are deleted permanently."
              confirmLabel="Delete asset"
              destructive
              onConfirm={async () => {
                const res = await deleteAssetAction(projectId, asset.id);
                if (!res.ok) return void toast.error(res.error);
                toast.success("Asset deleted");
                router.push(`/p/${projectId}/fact-check`);
              }}
            >
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                <Trash2 className="size-3.5" /> Delete asset
              </Button>
            </ConfirmButton>
            <Button size="sm" onClick={save} disabled={!dirty || pending || name.trim().length < 2 || !markets.length}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save changes
            </Button>
          </div>
        ) : undefined
      }
    >
      <fieldset disabled={!canEdit} className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="a-name">Asset name</Label>
          <Input id="a-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-ingredient">Active ingredient</Label>
          <Input id="a-ingredient" value={ingredient} onChange={(e) => setIngredient(e.target.value)} placeholder="optional" maxLength={200} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="a-aliases">Aliases</Label>
          <Input id="a-aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Comma-separated spelling variants" />
          <p className="text-xs text-muted-foreground">Changing names or markets rescans all tracked answers for this asset.</p>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>Markets</Label>
          <MarketPicker value={markets} onChange={setMarkets} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="a-desc">Notes</Label>
          <Textarea id="a-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Internal notes (optional)" maxLength={4000} />
        </div>
      </fieldset>
    </Panel>
  );
}
