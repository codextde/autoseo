"use client";

import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Italic,
  List as ListIcon,
  Lock,
  Minus,
  Plus,
  Trash2,
  Underline,
  Unlock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CHARTS, LISTS, TABLES, TOKENS } from "../../lib/catalog";
import { ICON_NAMES, ICONS } from "../../lib/icons";
import { allRunsHave, setMarkOnAll } from "../../lib/text";
import { FONT_OPTIONS, THEME_COLOR_LABELS, THEME_PRESETS } from "../../lib/theme";
import { LIST_VARIANTS, THEME_COLOR_KEYS, type SlideElement, type Theme } from "../../lib/types";
import { align, deleteSelection, duplicateSelection, reorder } from "./commands";
import { ColorField, KeySelect, NumberField, Row, Section, TextField, Toggle, TokenPicker } from "./fields";
import { useEditor, useEditorState } from "./store";
import { activeTextEditor } from "./text-editor";

const chartOptions = Object.entries(CHARTS).map(([key, d]) => ({ key, label: d.label, group: d.category }));
const listOptions = Object.entries(LISTS).map(([key, d]) => ({ key, label: d.label, group: d.category }));
const tableOptions = Object.entries(TABLES).map(([key, d]) => ({ key, label: d.label }));
const tokenOptions = Object.entries(TOKENS)
  .filter(([k]) => !k.endsWith("_prev"))
  .map(([key, d]) => ({ key, label: d.label, group: d.category }));
const trendOptions = Object.entries(CHARTS)
  .filter(([k]) => k.startsWith("trend."))
  .map(([key, d]) => ({ key, label: d.label }));

function IconBtn({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-xs" variant="ghost" onClick={onClick} disabled={disabled} aria-label={label} onMouseDown={(e) => e.preventDefault()}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Inspector() {
  const { store, canManage } = useEditor();
  const deck = useEditorState((s) => s.deck);
  const slideId = useEditorState((s) => s.slideId);
  const selection = useEditorState((s) => s.selection);
  const editingId = useEditorState((s) => s.editingId);
  const bundle = useEditorState((s) => s.bundle);
  const title = useEditorState((s) => s.title);
  const slide = deck.slides.find((s) => s.id === slideId) ?? deck.slides[0]!;
  const selected = slide.elements.filter((e) => selection.includes(e.id));
  const theme = deck.theme;
  const ctx = { bundle, report: { title } };

  const patch = <T extends SlideElement>(fn: (e: T) => T) => store.updateElements(selection, (e) => fn(e as T));
  const patchSlide = (fn: (s: typeof slide) => typeof slide) => store.commit(store.withSlide(fn));
  const patchTheme = (fn: (t: Theme) => Theme) => store.commit({ ...deck, theme: fn(deck.theme) });

  if (!canManage) {
    return <div className="p-4 text-xs text-muted-foreground">Read-only: you need the “Create, edit and share reports” permission to edit this report.</div>;
  }

  /* ─────────────── nothing selected: slide + theme ─────────────── */
  if (!selected.length) {
    const bg = slide.background;
    return (
      <div>
        <Section title="Slide">
          <Row label="Name">
            <TextField value={slide.name ?? ""} placeholder={`Slide ${deck.slides.indexOf(slide) + 1}`} onChange={(v) => patchSlide((s) => ({ ...s, name: v || undefined }))} />
          </Row>
          <Row label="Background">
            <ColorField value={bg.color} theme={theme} allowTransparent={false} onChange={(v) => patchSlide((s) => ({ ...s, background: { ...s.background, color: v } }))} />
          </Row>
          <Row label="Gradient">
            <Switch
              checked={!!bg.gradient}
              onCheckedChange={(v) => patchSlide((s) => ({ ...s, background: { ...s.background, gradient: v ? { from: "$bg", to: "$surface2", angle: 135 } : undefined } }))}
            />
          </Row>
          {bg.gradient && (
            <>
              <Row label="From">
                <ColorField value={bg.gradient.from} theme={theme} allowTransparent={false} onChange={(v) => patchSlide((s) => ({ ...s, background: { ...s.background, gradient: { ...s.background.gradient!, from: v } } }))} />
              </Row>
              <Row label="To">
                <ColorField value={bg.gradient.to} theme={theme} allowTransparent={false} onChange={(v) => patchSlide((s) => ({ ...s, background: { ...s.background, gradient: { ...s.background.gradient!, to: v } } }))} />
              </Row>
              <Row label="Angle">
                <NumberField value={bg.gradient.angle} min={-360} max={360} suffix="°" onChange={(v) => patchSlide((s) => ({ ...s, background: { ...s.background, gradient: { ...s.background.gradient!, angle: v } } }))} />
              </Row>
            </>
          )}
          <Row label="Hidden">
            <Switch checked={!!slide.hidden} onCheckedChange={(v) => patchSlide((s) => ({ ...s, hidden: v || undefined }))} />
            <span className="text-[11px] text-muted-foreground">Skip in present & export</span>
          </Row>
        </Section>
        <Section title="Speaker notes">
          <Textarea
            key={slide.id}
            defaultValue={slide.notes ?? ""}
            rows={4}
            placeholder="Notes shown in presenter view…"
            className="text-xs"
            onKeyDown={(e) => e.stopPropagation()}
            onBlur={(e) => e.target.value !== (slide.notes ?? "") && patchSlide((s) => ({ ...s, notes: e.target.value || undefined }))}
          />
        </Section>
        <Section title="Theme">
          <Row label="Preset">
            <Select
              value=""
              onValueChange={(v) => {
                const p = THEME_PRESETS.find((t) => t.name === v);
                if (p) patchTheme(() => ({ ...structuredClone(p), fonts: deck.theme.fonts }));
              }}
            >
              <SelectTrigger size="sm" className="h-7 w-full text-xs">
                <SelectValue placeholder={theme.name ?? "Custom"} />
              </SelectTrigger>
              <SelectContent>
                {THEME_PRESETS.map((p) => (
                  <SelectItem key={p.name} value={p.name!}>
                    <span className="flex items-center gap-2">
                      <span className="flex -space-x-1">
                        {[p.colors.bg, p.colors.accent, p.colors.text].map((c, i) => (
                          <span key={i} className="size-3 rounded-full ring-1 ring-black/10" style={{ background: c }} />
                        ))}
                      </span>
                      {p.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          {THEME_COLOR_KEYS.map((k) => (
            <Row key={k} label={THEME_COLOR_LABELS[k]}>
              <ColorField value={theme.colors[k]} theme={theme} allowTransparent={false} onChange={(v) => v.startsWith("#") && patchTheme((t) => ({ ...t, name: "Custom", colors: { ...t.colors, [k]: v } }))} />
            </Row>
          ))}
          <Row label="Heading font">
            <FontSelect value={theme.fonts.heading} onChange={(v) => patchTheme((t) => ({ ...t, fonts: { ...t.fonts, heading: v } }))} />
          </Row>
          <Row label="Body font">
            <FontSelect value={theme.fonts.body} onChange={(v) => patchTheme((t) => ({ ...t, fonts: { ...t.fonts, body: v } }))} />
          </Row>
        </Section>
        {deck.format === "classic" && (
          <Section title="Canvas">
            <Row label="Grid snap">
              <NumberField value={deck.grid ?? 0} min={0} max={200} suffix="px" onChange={(v) => store.commit({ ...deck, grid: v || undefined })} />
            </Row>
          </Section>
        )}
      </div>
    );
  }

  const single = selected.length === 1 ? selected[0]! : null;
  const editingText = !!editingId && single?.id === editingId;

  return (
    <div>
      <Section
        title={single ? (single.name ?? single.type) : `${selected.length} elements`}
        actions={
          <div className="flex items-center gap-0.5">
            <IconBtn label="Duplicate (⌘D)" onClick={() => duplicateSelection(store)}>
              <Copy />
            </IconBtn>
            <IconBtn label={selected.every((e) => e.locked) ? "Unlock" : "Lock"} onClick={() => patch((e) => ({ ...e, locked: e.locked ? undefined : true }))}>
              {selected.every((e) => e.locked) ? <Unlock /> : <Lock />}
            </IconBtn>
            <IconBtn label="Hide" onClick={() => patch((e) => ({ ...e, hidden: e.hidden ? undefined : true }))}>
              {selected.every((e) => e.hidden) ? <Eye /> : <EyeOff />}
            </IconBtn>
            <IconBtn label="Delete (⌫)" onClick={() => deleteSelection(store)}>
              <Trash2 />
            </IconBtn>
          </div>
        }
      >
        <div className="grid grid-cols-6 gap-0.5 rounded-lg border p-0.5">
          <IconBtn label="Align left" onClick={() => align(store, "left")}>
            <AlignStartVertical />
          </IconBtn>
          <IconBtn label="Align center" onClick={() => align(store, "hcenter")}>
            <AlignCenterVertical />
          </IconBtn>
          <IconBtn label="Align right" onClick={() => align(store, "right")}>
            <AlignEndVertical />
          </IconBtn>
          <IconBtn label="Align top" onClick={() => align(store, "top")}>
            <AlignStartHorizontal />
          </IconBtn>
          <IconBtn label="Align middle" onClick={() => align(store, "vcenter")}>
            <AlignCenterHorizontal />
          </IconBtn>
          <IconBtn label="Align bottom" onClick={() => align(store, "bottom")}>
            <AlignEndHorizontal />
          </IconBtn>
        </div>
        {selected.length >= 3 && (
          <div className="flex gap-1">
            <Button size="xs" variant="outline" className="flex-1" onClick={() => align(store, "hdistribute")}>
              <AlignHorizontalDistributeCenter /> Distribute H
            </Button>
            <Button size="xs" variant="outline" className="flex-1" onClick={() => align(store, "vdistribute")}>
              <AlignVerticalDistributeCenter /> Distribute V
            </Button>
          </div>
        )}
      </Section>

      {single && (
        <>
          <Section title="Position">
            <div className="grid grid-cols-2 gap-1.5">
              <NumberField label="X" value={single.x} onChange={(v) => patch((e) => ({ ...e, x: v }))} />
              <NumberField label="Y" value={single.y} onChange={(v) => patch((e) => ({ ...e, y: v }))} />
              <NumberField label="R" value={single.rotation} min={-360} max={360} suffix="°" onChange={(v) => patch((e) => ({ ...e, rotation: v }))} />
              <div className="flex items-center gap-1">
                <NumberField label="Z" value={slide.elements.indexOf(single)} min={0} max={slide.elements.length - 1} onChange={(v) => {
                  const cur = slide.elements.indexOf(single);
                  const steps = v - cur;
                  for (let i = 0; i < Math.abs(steps); i++) reorder(store, steps > 0 ? "forward" : "backward");
                }} />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-0.5 rounded-lg border p-0.5">
              <IconBtn label="Bring to front (⌘⇧])" onClick={() => reorder(store, "front")}>
                <ArrowUpToLine />
              </IconBtn>
              <IconBtn label="Bring forward (⌘])" onClick={() => reorder(store, "forward")}>
                <ChevronUp />
              </IconBtn>
              <IconBtn label="Send backward (⌘[)" onClick={() => reorder(store, "backward")}>
                <ChevronDown />
              </IconBtn>
              <IconBtn label="Send to back (⌘⇧[)" onClick={() => reorder(store, "back")}>
                <ArrowDownToLine />
              </IconBtn>
            </div>
          </Section>
          <Section title="Layout">
            <div className="grid grid-cols-2 gap-1.5">
              <NumberField label="W" value={single.w} min={1} onChange={(v) => patch((e) => ({ ...e, w: v }))} />
              <NumberField label="H" value={single.h} min={1} onChange={(v) => patch((e) => ({ ...e, h: v }))} />
            </div>
            <Row label="Opacity">
              <NumberField value={Math.round((single.opacity ?? 1) * 100)} min={0} max={100} suffix="%" onChange={(v) => patch((e) => ({ ...e, opacity: v >= 100 ? undefined : v / 100 }))} />
            </Row>
            <Row label="Name">
              <TextField value={single.name ?? ""} placeholder={single.type} onChange={(v) => patch((e) => ({ ...e, name: v || undefined }))} />
            </Row>
          </Section>
          <TypeSection el={single} theme={theme} ctx={ctx} editingText={editingText} patch={patch} />
        </>
      )}
    </div>
  );
}

function FontSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="h-7 w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FONT_OPTIONS.map((f) => (
          <SelectItem key={f.value} value={f.value}>
            <span style={{ fontFamily: f.stack }}>{f.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ElementFontSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="h-7 w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="heading">Theme heading</SelectItem>
        <SelectItem value="body">Theme body</SelectItem>
        <SelectItem value="mono">Monospace</SelectItem>
        {FONT_OPTIONS.map((f) => (
          <SelectItem key={f.value} value={f.value}>
            <span style={{ fontFamily: f.stack }}>{f.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type Patch = <T extends SlideElement>(fn: (e: T) => T) => void;

function TypeSection({ el, theme, ctx, editingText, patch }: { el: SlideElement; theme: Theme; ctx: { bundle: import("../../lib/bundle").DataBundle | null; report: { title: string } }; editingText: boolean; patch: Patch }) {
  switch (el.type) {
    case "text": {
      const st = el.style;
      const setStyle = (p: Partial<typeof st>) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, ...p } }));
      const mark = (m: "b" | "i" | "u") => {
        if (editingText) activeTextEditor.current?.exec(m === "b" ? "bold" : m === "i" ? "italic" : "underline");
        else patch<typeof el>((e) => ({ ...e, paragraphs: setMarkOnAll(e.paragraphs, { [m]: !allRunsHave(e.paragraphs, m) }) }));
      };
      return (
        <>
          <Section title="Text">
            <Row label="Font">
              <ElementFontSelect value={st.fontFamily} onChange={(v) => setStyle({ fontFamily: v })} />
            </Row>
            <div className="grid grid-cols-2 gap-1.5">
              <NumberField label="Size" value={st.fontSize} min={4} max={800} onChange={(v) => setStyle({ fontSize: v })} />
              <Select value={String(st.fontWeight)} onValueChange={(v) => setStyle({ fontWeight: Number(v) })}>
                <SelectTrigger size="sm" className="h-7 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[300, 400, 500, 600, 700, 800].map((w) => (
                    <SelectItem key={w} value={String(w)}>
                      {{ 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra bold" }[w]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Row label="Color">
              <ColorField
                value={st.color}
                theme={theme}
                allowTransparent={false}
                onPickStart={editingText ? () => undefined : undefined}
                onChange={(v) => {
                  if (editingText) activeTextEditor.current?.exec("foreColor", v.startsWith("$") ? theme.colors[v.slice(1) as keyof Theme["colors"]] : v);
                  else setStyle({ color: v });
                }}
              />
            </Row>
            <div className="flex flex-wrap gap-1">
              <Toggle pressed={editingText ? false : allRunsHave(el.paragraphs, "b")} onClick={() => mark("b")} title="Bold (⌘B)">
                <Bold className="size-3.5" />
              </Toggle>
              <Toggle pressed={editingText ? false : allRunsHave(el.paragraphs, "i")} onClick={() => mark("i")} title="Italic (⌘I)">
                <Italic className="size-3.5" />
              </Toggle>
              <Toggle pressed={editingText ? false : allRunsHave(el.paragraphs, "u")} onClick={() => mark("u")} title="Underline (⌘U)">
                <Underline className="size-3.5" />
              </Toggle>
              <Toggle pressed={!!st.uppercase} onClick={() => setStyle({ uppercase: !st.uppercase || undefined })} title="Uppercase">
                Aa
              </Toggle>
              <Toggle
                pressed={el.paragraphs.every((p) => p.bullet)}
                onClick={() => patch<typeof el>((e) => ({ ...e, paragraphs: e.paragraphs.map((p) => ({ ...p, bullet: e.paragraphs.every((x) => x.bullet) ? undefined : true })) }))}
                title="Bullets"
              >
                <ListIcon className="size-3.5" />
              </Toggle>
              <span className="mx-0.5 w-px self-stretch bg-border" />
              {(["left", "center", "right"] as const).map((a) => (
                <Toggle key={a} pressed={st.align === a} onClick={() => setStyle({ align: a })} title={`Align ${a}`}>
                  {a === "left" ? <AlignLeft className="size-3.5" /> : a === "center" ? <AlignCenter className="size-3.5" /> : <AlignRight className="size-3.5" />}
                </Toggle>
              ))}
            </div>
            <Row label="Vertical">
              <div className="flex gap-1">
                {(["top", "middle", "bottom"] as const).map((v) => (
                  <Toggle key={v} pressed={st.valign === v} onClick={() => setStyle({ valign: v })}>
                    {v === "top" ? "Top" : v === "middle" ? "Mid" : "Bottom"}
                  </Toggle>
                ))}
              </div>
            </Row>
            <div className="grid grid-cols-2 gap-1.5">
              <NumberField label="Line" value={st.lineHeight} min={0.6} max={4} step={0.05} onChange={(v) => setStyle({ lineHeight: v })} />
              <NumberField label="Spacing" value={st.letterSpacing} min={-0.5} max={2} step={0.01} onChange={(v) => setStyle({ letterSpacing: v })} />
            </div>
            <Row label="Fill">
              <ColorField value={el.fill ?? "transparent"} theme={theme} onChange={(v) => patch<typeof el>((e) => ({ ...e, fill: v === "transparent" ? undefined : v }))} />
            </Row>
            {el.fill && (
              <div className="grid grid-cols-2 gap-1.5">
                <NumberField label="Pad" value={el.padding ?? 0} min={0} max={400} onChange={(v) => patch<typeof el>((e) => ({ ...e, padding: v || undefined }))} />
                <NumberField label="Radius" value={el.radius ?? 0} min={0} onChange={(v) => patch<typeof el>((e) => ({ ...e, radius: v || undefined }))} />
              </div>
            )}
          </Section>
          <Section title="Live data insert">
            <TokenPicker
              ctx={ctx}
              keepFocus={editingText}
              onPick={(key) => {
                if (editingText) activeTextEditor.current?.insertToken(key);
                else
                  patch<typeof el>((e) => {
                    const paragraphs = e.paragraphs.length ? [...e.paragraphs] : [{ runs: [] }];
                    const last = paragraphs[paragraphs.length - 1]!;
                    paragraphs[paragraphs.length - 1] = { ...last, runs: [...last.runs, ...(last.runs.length ? [{ text: " " }] : []), { text: "", token: key }] };
                    return { ...e, paragraphs };
                  });
              }}
            />
            <p className="text-[11px] text-muted-foreground">Purple tokens refresh for every client and date range.</p>
          </Section>
        </>
      );
    }
    case "box":
      return (
        <Section title="Shape">
          <Row label="Shape">
            <Select value={el.shape} onValueChange={(v) => patch<typeof el>((e) => ({ ...e, shape: v as typeof el.shape }))}>
              <SelectTrigger size="sm" className="h-7 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rect">Rectangle</SelectItem>
                <SelectItem value="ellipse">Ellipse</SelectItem>
                <SelectItem value="triangle">Triangle</SelectItem>
                <SelectItem value="line">Line</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          {el.shape !== "line" && (
            <Row label="Fill">
              <ColorField value={el.fill} theme={theme} onChange={(v) => patch<typeof el>((e) => ({ ...e, fill: v }))} />
            </Row>
          )}
          {el.shape !== "line" && (
            <Row label="Gradient">
              <Switch checked={!!el.gradient} onCheckedChange={(v) => patch<typeof el>((e) => ({ ...e, gradient: v ? { from: "$accent", to: "$accent2", angle: 135 } : undefined }))} />
            </Row>
          )}
          {el.gradient && (
            <>
              <Row label="From">
                <ColorField value={el.gradient.from} theme={theme} allowTransparent={false} onChange={(v) => patch<typeof el>((e) => ({ ...e, gradient: { ...e.gradient!, from: v } }))} />
              </Row>
              <Row label="To">
                <ColorField value={el.gradient.to} theme={theme} allowTransparent={false} onChange={(v) => patch<typeof el>((e) => ({ ...e, gradient: { ...e.gradient!, to: v } }))} />
              </Row>
              <Row label="Angle">
                <NumberField value={el.gradient.angle} suffix="°" onChange={(v) => patch<typeof el>((e) => ({ ...e, gradient: { ...e.gradient!, angle: v } }))} />
              </Row>
            </>
          )}
          <Row label="Border">
            <ColorField value={el.stroke} theme={theme} onChange={(v) => patch<typeof el>((e) => ({ ...e, stroke: v, strokeWidth: e.strokeWidth || (v === "transparent" ? 0 : 2) }))} />
          </Row>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField label="Width" value={el.strokeWidth} min={0} max={200} onChange={(v) => patch<typeof el>((e) => ({ ...e, strokeWidth: v }))} />
            {el.shape === "rect" && <NumberField label="Radius" value={el.radius} min={0} onChange={(v) => patch<typeof el>((e) => ({ ...e, radius: v }))} />}
          </div>
          <div className="flex gap-1">
            <Toggle pressed={el.strokeStyle === "dashed"} onClick={() => patch<typeof el>((e) => ({ ...e, strokeStyle: e.strokeStyle === "dashed" ? undefined : "dashed" }))}>
              Dashed
            </Toggle>
            {el.shape !== "line" && (
              <Toggle pressed={!!el.shadow} onClick={() => patch<typeof el>((e) => ({ ...e, shadow: e.shadow ? undefined : true }))}>
                Shadow
              </Toggle>
            )}
          </div>
        </Section>
      );
    case "image":
      return (
        <Section title="Image">
          <Row label="Source">
            <span className="truncate text-xs">
              {el.src.kind === "asset" ? "Uploaded asset" : el.src.kind === "url" ? el.src.url : el.src.token === "agency.logo" ? "Agency logo (live)" : "Client logo (live)"}
            </span>
          </Row>
          {el.src.kind === "url" && (
            <Row label="URL">
              <TextField value={el.src.url} onChange={(v) => /^https?:\/\//i.test(v) && patch<typeof el>((e) => ({ ...e, src: { kind: "url", url: v } }))} />
            </Row>
          )}
          <Row label="Live logo">
            <Select
              value={el.src.kind === "token" ? el.src.token : "none"}
              onValueChange={(v) => v !== "none" && patch<typeof el>((e) => ({ ...e, src: { kind: "token", token: v as "agency.logo" | "client.logo" }, fit: "contain" }))}
            >
              <SelectTrigger size="sm" className="h-7 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="client.logo">Client logo</SelectItem>
                <SelectItem value="agency.logo">Agency logo</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Fit">
            <div className="flex gap-1">
              {(["cover", "contain"] as const).map((f) => (
                <Toggle key={f} pressed={el.fit === f} onClick={() => patch<typeof el>((e) => ({ ...e, fit: f }))}>
                  {f === "cover" ? "Fill" : "Fit"}
                </Toggle>
              ))}
            </div>
          </Row>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField label="Radius" value={el.radius} min={0} onChange={(v) => patch<typeof el>((e) => ({ ...e, radius: v }))} />
            <NumberField label="Border" value={el.strokeWidth ?? 0} min={0} onChange={(v) => patch<typeof el>((e) => ({ ...e, strokeWidth: v || undefined, stroke: e.stroke ?? "$border" }))} />
          </div>
          <Row label="Alt text">
            <TextField value={el.alt ?? ""} onChange={(v) => patch<typeof el>((e) => ({ ...e, alt: v || undefined }))} />
          </Row>
        </Section>
      );
    case "icon":
      return (
        <Section title="Icon">
          <div className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto rounded-lg border p-1">
            {ICON_NAMES.map((n) => (
              <button
                key={n}
                type="button"
                title={n}
                onClick={() => patch<typeof el>((e) => ({ ...e, icon: n }))}
                className={`flex size-7 items-center justify-center rounded ${el.icon === n ? "bg-foreground text-background" : "hover:bg-muted"}`}
              >
                <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  {ICONS[n]!.map(([tag, attrs], i) => {
                    const Tag = tag as "path";
                    return <Tag key={i} {...(attrs as Record<string, string>)} />;
                  })}
                </svg>
              </button>
            ))}
          </div>
          <Row label="Color">
            <ColorField value={el.color} theme={theme} allowTransparent={false} onChange={(v) => patch<typeof el>((e) => ({ ...e, color: v }))} />
          </Row>
          <Row label="Background">
            <ColorField value={el.bg ?? "transparent"} theme={theme} onChange={(v) => patch<typeof el>((e) => ({ ...e, bg: v === "transparent" ? undefined : v }))} />
          </Row>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField label="Stroke" value={el.strokeWidth} min={0.5} max={4} step={0.25} onChange={(v) => patch<typeof el>((e) => ({ ...e, strokeWidth: v }))} />
            <NumberField label="Radius" value={el.radius ?? 0} min={0} onChange={(v) => patch<typeof el>((e) => ({ ...e, radius: v }))} />
          </div>
        </Section>
      );
    case "chart": {
      const def = CHARTS[el.metric];
      return (
        <Section title="Chart">
          <Row label="Data">
            <KeySelect value={el.metric} options={chartOptions} onChange={(v) => patch<typeof el>((e) => ({ ...e, metric: v, chartType: CHARTS[v]!.types.includes(e.chartType) ? e.chartType : CHARTS[v]!.defaultType }))} />
          </Row>
          <Row label="Type">
            <div className="flex flex-wrap gap-1">
              {(def?.types ?? []).map((t) => (
                <Toggle key={t} pressed={el.chartType === t} onClick={() => patch<typeof el>((e) => ({ ...e, chartType: t }))}>
                  {{ line: "Line", area: "Area", bar: "Bars", hbar: "Rows", donut: "Donut" }[t]}
                </Toggle>
              ))}
            </div>
          </Row>
          <Row label="Title">
            <TextField value={el.title ?? ""} placeholder="No title" onChange={(v) => patch<typeof el>((e) => ({ ...e, title: v || undefined }))} />
          </Row>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField label="Items" value={el.options.limit ?? 8} min={1} max={30} onChange={(v) => patch<typeof el>((e) => ({ ...e, options: { ...e.options, limit: v } }))} />
            <NumberField label="Font" value={el.style.fontSize} min={6} max={120} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, fontSize: v } }))} />
          </div>
          <div className="flex flex-wrap gap-1">
            {(["legend", "grid", "values", "highlightOwn"] as const).map((k) => (
              <Toggle key={k} pressed={el.options[k] !== false} onClick={() => patch<typeof el>((e) => ({ ...e, options: { ...e.options, [k]: e.options[k] === false } }))}>
                {{ legend: "Legend", grid: "Grid", values: "Values", highlightOwn: "Highlight you" }[k]}
              </Toggle>
            ))}
          </div>
          <Row label="Labels">
            <ColorField value={el.style.color} theme={theme} allowTransparent={false} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, color: v } }))} />
          </Row>
          <Row label="Accent">
            <ColorField value={el.options.colors?.[0] ?? "$accent"} theme={theme} allowTransparent={false} onChange={(v) => patch<typeof el>((e) => ({ ...e, options: { ...e.options, colors: v === "$accent" ? undefined : [v, ...theme.chart.slice(1)] } }))} />
          </Row>
          <Row label="Card">
            <ColorField value={el.style.fill ?? "transparent"} theme={theme} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, fill: v === "transparent" ? undefined : v } }))} />
          </Row>
          {def && <p className="text-[11px] text-muted-foreground">{def.description}</p>}
        </Section>
      );
    }
    case "list":
      return (
        <Section title="Live list">
          <Row label="Data">
            <KeySelect value={el.source} options={listOptions} onChange={(v) => patch<typeof el>((e) => ({ ...e, source: v }))} />
          </Row>
          <Row label="Style">
            <div className="flex gap-1">
              {LIST_VARIANTS.map((v) => (
                <Toggle key={v} pressed={el.style.variant === v} onClick={() => patch<typeof el>((e) => ({ ...e, style: { ...e.style, variant: v } }))}>
                  {{ rows: "Rows", bullets: "Bullets", cards: "Cards" }[v]}
                </Toggle>
              ))}
            </div>
          </Row>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField label="Items" value={el.limit} min={1} max={30} onChange={(v) => patch<typeof el>((e) => ({ ...e, limit: v }))} />
            <NumberField label="Font" value={el.style.fontSize} min={6} max={200} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, fontSize: v } }))} />
          </div>
          <div className="flex flex-wrap gap-1">
            {(["showRank", "showValue", "showBar"] as const).map((k) => (
              <Toggle key={k} pressed={el.style[k]} onClick={() => patch<typeof el>((e) => ({ ...e, style: { ...e.style, [k]: !e.style[k] } }))}>
                {{ showRank: "Rank", showValue: "Value", showBar: "Bars" }[k]}
              </Toggle>
            ))}
          </div>
          <Row label="Text">
            <ColorField value={el.style.color} theme={theme} allowTransparent={false} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, color: v } }))} />
          </Row>
          <Row label="Accent">
            <ColorField value={el.style.accent} theme={theme} allowTransparent={false} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, accent: v } }))} />
          </Row>
          <Row label="Card">
            <ColorField value={el.style.fill ?? "transparent"} theme={theme} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, fill: v === "transparent" ? undefined : v } }))} />
          </Row>
        </Section>
      );
    case "kpi":
      return (
        <Section title="KPI tile">
          <Row label="Metric">
            <KeySelect value={el.metric} options={tokenOptions} onChange={(v) => patch<typeof el>((e) => ({ ...e, metric: v, label: TOKENS[v]?.label ?? e.label, deltaMetric: TOKENS[`${v}_delta`] ? `${v}_delta` : undefined }))} />
          </Row>
          <Row label="Label">
            <TextField value={el.label} onChange={(v) => patch<typeof el>((e) => ({ ...e, label: v }))} />
          </Row>
          <Row label="Change">
            <KeySelect value={el.deltaMetric ?? ""} placeholder="None" options={[{ key: "", label: "None" }, ...tokenOptions.filter((o) => o.key.includes("delta") || o.key.endsWith("_gap"))]} onChange={(v) => patch<typeof el>((e) => ({ ...e, deltaMetric: v || undefined }))} />
          </Row>
          <Row label="Sparkline">
            <KeySelect value={el.sparkline ?? ""} placeholder="None" options={[{ key: "", label: "None" }, ...trendOptions]} onChange={(v) => patch<typeof el>((e) => ({ ...e, sparkline: v || undefined }))} />
          </Row>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField label="Value" value={el.style.valueSize} min={8} max={600} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, valueSize: v } }))} />
            <NumberField label="Label" value={el.style.labelSize} min={6} max={200} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, labelSize: v } }))} />
            <NumberField label="Radius" value={el.style.radius} min={0} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, radius: v } }))} />
            <div className="flex gap-1">
              {(["left", "center"] as const).map((a) => (
                <Toggle key={a} pressed={el.style.align === a} onClick={() => patch<typeof el>((e) => ({ ...e, style: { ...e.style, align: a } }))}>
                  {a === "left" ? <AlignLeft className="size-3.5" /> : <AlignCenter className="size-3.5" />}
                </Toggle>
              ))}
            </div>
          </div>
          <Row label="Fill">
            <ColorField value={el.style.fill} theme={theme} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, fill: v } }))} />
          </Row>
          <Row label="Border">
            <ColorField value={el.style.stroke} theme={theme} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, stroke: v } }))} />
          </Row>
          <Row label="Value color">
            <ColorField value={el.style.valueColor} theme={theme} allowTransparent={false} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, valueColor: v } }))} />
          </Row>
        </Section>
      );
    case "score":
      return (
        <Section title="Score ring">
          <Row label="Metric">
            <KeySelect value={el.metric} options={tokenOptions.filter((o) => ["percent", "score"].includes(TOKENS[o.key]!.format))} onChange={(v) => patch<typeof el>((e) => ({ ...e, metric: v }))} />
          </Row>
          <Row label="Label">
            <TextField value={el.label ?? ""} onChange={(v) => patch<typeof el>((e) => ({ ...e, label: v || undefined }))} />
          </Row>
          <Row label="Ring">
            <ColorField value={el.style.color} theme={theme} allowTransparent={false} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, color: v } }))} />
          </Row>
          <Row label="Track">
            <ColorField value={el.style.track} theme={theme} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, track: v } }))} />
          </Row>
          <Row label="Thickness">
            <NumberField value={el.style.thickness} min={1} max={400} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, thickness: v } }))} />
          </Row>
        </Section>
      );
    case "table":
      return <TableSection el={el} theme={theme} patch={patch} />;
  }
}

function TableSection({ el, theme, patch }: { el: Extract<SlideElement, { type: "table" }>; theme: Theme; patch: Patch }) {
  const rows = el.rows.length ? el.rows : [[""]];
  const cols = Math.max(...rows.map((r) => r.length), 1);
  const setRows = (next: string[][]) => patch<typeof el>((e) => ({ ...e, rows: next }));
  return (
    <Section title="Table">
      <Row label="Data">
        <div className="flex gap-1">
          <Toggle pressed={el.mode === "static"} onClick={() => patch<typeof el>((e) => ({ ...e, mode: "static", rows: e.rows.length ? e.rows : [["Metric", "Value"], ["Visibility", "{{ai.visibility}}"]] }))}>
            Static
          </Toggle>
          <Toggle pressed={el.mode === "live"} onClick={() => patch<typeof el>((e) => ({ ...e, mode: "live", source: e.source ?? "table.competitors" }))}>
            Live
          </Toggle>
        </div>
      </Row>
      {el.mode === "live" ? (
        <>
          <Row label="Source">
            <KeySelect value={el.source} options={tableOptions} onChange={(v) => patch<typeof el>((e) => ({ ...e, source: v }))} />
          </Row>
          <Row label="Rows">
            <NumberField value={el.limit} min={1} max={30} onChange={(v) => patch<typeof el>((e) => ({ ...e, limit: v }))} />
          </Row>
        </>
      ) : (
        <div className="space-y-1.5">
          <div className="max-h-64 space-y-1 overflow-auto">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-1">
                {Array.from({ length: cols }, (_, j) => (
                  <TextField
                    key={j}
                    value={r[j] ?? ""}
                    className={i === 0 && el.header ? "font-semibold" : undefined}
                    onChange={(v) => setRows(rows.map((row, ri) => (ri === i ? Array.from({ length: cols }, (_, cj) => (cj === j ? v : (row[cj] ?? ""))) : row)))}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            <Button size="xs" variant="outline" onClick={() => rows.length < 60 && setRows([...rows, Array.from({ length: cols }, () => "")])}>
              <Plus /> Row
            </Button>
            <Button size="xs" variant="outline" onClick={() => rows.length > 1 && setRows(rows.slice(0, -1))}>
              <Minus /> Row
            </Button>
            <Button size="xs" variant="outline" onClick={() => cols < 12 && setRows(rows.map((r) => [...Array.from({ length: cols }, (_, j) => r[j] ?? ""), ""]))}>
              <Plus /> Col
            </Button>
            <Button size="xs" variant="outline" onClick={() => cols > 1 && setRows(rows.map((r) => r.slice(0, cols - 1)))}>
              <Minus /> Col
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Cells can contain live tokens like {"{{ai.visibility}}"}.</p>
        </div>
      )}
      <Row label="Header">
        <Switch checked={el.header} onCheckedChange={(v) => patch<typeof el>((e) => ({ ...e, header: v }))} />
      </Row>
      <Row label="Font">
        <NumberField value={el.style.fontSize} min={6} max={120} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, fontSize: v } }))} />
      </Row>
      <Row label="Text">
        <ColorField value={el.style.color} theme={theme} allowTransparent={false} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, color: v } }))} />
      </Row>
      <Row label="Header bg">
        <ColorField value={el.style.headerFill} theme={theme} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, headerFill: v } }))} />
      </Row>
      <Row label="Stripes">
        <ColorField value={el.style.stripe ?? "transparent"} theme={theme} onChange={(v) => patch<typeof el>((e) => ({ ...e, style: { ...e.style, stripe: v === "transparent" ? undefined : v } }))} />
      </Row>
    </Section>
  );
}
