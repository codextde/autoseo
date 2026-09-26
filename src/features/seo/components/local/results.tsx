"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { BadgeCheck, ChevronDown, Clock, Crosshair, ExternalLink, Image as ImageIcon, MapPin, MessageSquareReply, Phone, SearchX, Star, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { KpiStrip, formatNumber } from "@/components/app/metrics";
import type { LocalRunTool } from "@/server/seo/local";
import { ExternalUrl } from "../shared/external-link";
import { ExportMenu } from "../shared/export-menu";
import { bool, num, pickBusiness, ratingOf, rec, recs, str, strs, type PickedBusiness, type Rec } from "./shared";
import { cn } from "@/lib/utils";

export type UseBusiness = (business: PickedBusiness, tool: LocalRunTool) => void;

/* ───────────────────────────── Small pieces ───────────────────────────── */

export function Stars({ value, className, size = "size-3.5" }: { value: number | null; className?: string; size?: string }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const full = Math.round(value);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${value} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={cn(size, i < full ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")} />
      ))}
    </span>
  );
}

function RatingCell({ row }: { row: Rec }) {
  const { value, votes } = ratingOf(row);
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 tabular">
      <Star className="size-3.5 fill-amber-400 text-amber-400" />
      <span className="font-medium">{value.toFixed(1)}</span>
      {votes != null && <span className="text-xs text-muted-foreground">({formatNumber(votes, { maximumFractionDigits: 0 })})</span>}
    </span>
  );
}

function ClaimedBadge({ value }: { value: boolean | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return value ? (
    <Badge variant="secondary" className="gap-1 bg-success/12 text-success">
      <BadgeCheck className="size-3" /> Claimed
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Unclaimed
    </Badge>
  );
}

function categoriesOf(row: Rec): string {
  const main = str(row.category);
  const extra = strs(row.additional_categories);
  return [main, ...extra].filter(Boolean).join(", ");
}

function website(row: Rec): string | null {
  return str(row.url) ?? (str(row.domain) ? `https://${str(row.domain)}` : null);
}

function cidOf(row: Rec): string | null {
  return str(row.cid) ?? (num(row.cid) != null ? String(num(row.cid)) : null);
}

const USE_TARGETS: { tool: LocalRunTool; label: string }[] = [
  { tool: "rank_grid", label: "Rank grid around it" },
  { tool: "business_profile", label: "Business profile" },
  { tool: "reviews", label: "Reviews" },
  { tool: "questions", label: "Questions & answers" },
  { tool: "posts", label: "Posts" },
  { tool: "local_serp", label: "Local SERP from here" },
];

function UseForMenu({ row, onUse }: { row: Rec; onUse: UseBusiness }) {
  const b = pickBusiness(row);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" className="gap-1" onClick={(e) => e.stopPropagation()}>
          Use <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="truncate text-xs text-muted-foreground">{b.title ?? "Business"}</DropdownMenuLabel>
        {USE_TARGETS.map((t) => (
          <DropdownMenuItem key={t.tool} disabled={(t.tool === "rank_grid" || t.tool === "local_serp" || t.tool === "questions") && b.latitude == null} onSelect={() => onUse(b, t.tool)}>
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NoResults({ title, description }: { title: string; description?: string }) {
  return <EmptyState compact icon={SearchX} title={title} description={description} />;
}

const fadeIn = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2 } };

/* ───────────────────────────── Business search ───────────────────────────── */

const BUSINESS_HEADERS = ["Title", "Category", "Rating", "Reviews", "Phone", "Address", "Website", "Claimed", "CID", "Place ID", "Latitude", "Longitude"];

export function BusinessSearchResult({ result, onUse }: { result: unknown; onUse: UseBusiness }) {
  const r = rec(result);
  const rows = recs(r?.businesses);
  const total = num(r?.totalCount);
  const columns: Column<Rec>[] = [
    {
      id: "title",
      header: "Business",
      cell: (row) => (
        <div className="min-w-0 max-w-[18rem]">
          <div className="truncate font-medium">{str(row.title) ?? "—"}</div>
          <div className="truncate text-xs text-muted-foreground">{categoriesOf(row) || "—"}</div>
        </div>
      ),
    },
    { id: "rating", header: "Rating", cell: (row) => <RatingCell row={row} /> },
    { id: "phone", header: "Phone", hideBelow: "lg", cell: (row) => <span className="whitespace-nowrap tabular">{str(row.phone) ?? "—"}</span> },
    { id: "address", header: "Address", hideBelow: "xl", cell: (row) => <span className="line-clamp-2 max-w-60 text-xs">{str(row.address) ?? "—"}</span> },
    { id: "website", header: "Website", hideBelow: "md", cell: (row) => <ExternalUrl href={website(row)} label={str(row.domain) ?? undefined} maxWidth="max-w-44" /> },
    { id: "claimed", header: "Claimed", hideBelow: "md", cell: (row) => <ClaimedBadge value={bool(row.is_claimed)} /> },
    { id: "cid", header: "CID", hideBelow: "xl", cell: (row) => <code className="text-[11px] text-muted-foreground">{cidOf(row) ?? "—"}</code> },
    { id: "use", header: "", align: "right", cell: (row) => <UseForMenu row={row} onUse={onUse} /> },
  ];
  const exportRows = () =>
    rows.map((row) => {
      const { value, votes } = ratingOf(row);
      return [str(row.title), categoriesOf(row), value, votes, str(row.phone), str(row.address), website(row), bool(row.is_claimed) == null ? "" : bool(row.is_claimed) ? "yes" : "no", cidOf(row), str(row.place_id), num(row.latitude), num(row.longitude)];
    });
  return (
    <motion.div {...fadeIn} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground tabular">
          {rows.length} business{rows.length === 1 ? "" : "es"}
          {total != null && total > rows.length ? ` of ${total.toLocaleString()} matching` : ""}
        </span>
        <ExportMenu disabled={!rows.length} getData={() => ({ headers: BUSINESS_HEADERS, rows: exportRows(), filename: "local-businesses" })} />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => cidOf(row) ?? str(row.place_id) ?? `${str(row.title)}-${num(row.latitude)}`}
        paginate={false}
        dense
        empty={<NoResults title="No businesses found" description="Try a larger radius, fewer filters or a different category." />}
        mobileCard={(row) => (
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">{str(row.title) ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{categoriesOf(row) || "—"}</div>
              </div>
              <UseForMenu row={row} onUse={onUse} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <RatingCell row={row} />
              <ClaimedBadge value={bool(row.is_claimed)} />
            </div>
            {str(row.address) && <p className="text-xs text-muted-foreground">{str(row.address)}</p>}
            {website(row) && <ExternalUrl href={website(row)} label={str(row.domain) ?? undefined} className="text-xs" />}
          </div>
        )}
      />
    </motion.div>
  );
}

/* ───────────────────────────── Local SERP ───────────────────────────── */

const SERP_HEADERS = ["Rank", "Title", "Domain", "URL", "Rating", "Reviews", "Category", "Phone", "Address", "Claimed", "CID", "Place ID"];

export function LocalSerpResult({ result, onUse }: { result: unknown; onUse: UseBusiness }) {
  const r = rec(result);
  const rows = recs(r?.items);
  const type = str(r?.searchType) === "local_finder" ? "Local Finder" : "Google Maps";
  const rank = (row: Rec) => num(row.rank_group) ?? num(row.rank_absolute);
  const columns: Column<Rec>[] = [
    { id: "rank", header: "#", width: "3rem", cell: (row) => <span className="font-mono text-xs tabular">{rank(row) ?? "—"}</span> },
    {
      id: "title",
      header: "Business",
      cell: (row) => (
        <div className="min-w-0 max-w-[18rem]">
          <div className="truncate font-medium">{str(row.title) ?? "—"}</div>
          <div className="truncate text-xs text-muted-foreground">{categoriesOf(row) || "—"}</div>
        </div>
      ),
    },
    { id: "rating", header: "Rating", cell: (row) => <RatingCell row={row} /> },
    { id: "site", header: "Website", hideBelow: "md", cell: (row) => <ExternalUrl href={website(row)} label={str(row.domain) ?? undefined} maxWidth="max-w-44" /> },
    { id: "phone", header: "Phone", hideBelow: "xl", cell: (row) => <span className="whitespace-nowrap tabular">{str(row.phone) ?? "—"}</span> },
    { id: "address", header: "Address", hideBelow: "lg", cell: (row) => <span className="line-clamp-2 max-w-56 text-xs">{str(row.address) ?? "—"}</span> },
    { id: "claimed", header: "Claimed", hideBelow: "lg", cell: (row) => <ClaimedBadge value={bool(row.is_claimed)} /> },
    { id: "cid", header: "CID", hideBelow: "xl", cell: (row) => <code className="text-[11px] text-muted-foreground">{cidOf(row) ?? "—"}</code> },
    { id: "use", header: "", align: "right", cell: (row) => <UseForMenu row={row} onUse={onUse} /> },
  ];
  const exportRows = () =>
    rows.map((row) => {
      const { value, votes } = ratingOf(row);
      return [rank(row), str(row.title), str(row.domain), website(row), value, votes, categoriesOf(row), str(row.phone), str(row.address), bool(row.is_claimed) == null ? "" : bool(row.is_claimed) ? "yes" : "no", cidOf(row), str(row.place_id)];
    });
  return (
    <motion.div {...fadeIn} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground tabular">
          {rows.length} {type} result{rows.length === 1 ? "" : "s"}
        </span>
        <ExportMenu disabled={!rows.length} getData={() => ({ headers: SERP_HEADERS, rows: exportRows(), filename: "local-serp" })} />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => `${rank(row)}-${cidOf(row) ?? str(row.title)}`}
        paginate={false}
        dense
        empty={<NoResults title="No local results at this location" description="Google returned no businesses — try another zoom or a broader keyword." />}
        mobileCard={(row) => (
          <div className="flex items-start gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs tabular">{rank(row) ?? "—"}</span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="font-medium">{str(row.title) ?? "—"}</div>
              <div className="text-xs text-muted-foreground">{categoriesOf(row) || "—"}</div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <RatingCell row={row} />
                <ClaimedBadge value={bool(row.is_claimed)} />
              </div>
            </div>
            <UseForMenu row={row} onUse={onUse} />
          </div>
        )}
      />
    </motion.div>
  );
}

/* ───────────────────────────── Business profile ───────────────────────────── */

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

function hhmm(t: unknown): string | null {
  const o = rec(t);
  const h = num(o?.hour);
  const m = num(o?.minute);
  if (h == null) return null;
  return `${String(h).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}`;
}

function DistributionBars({ distribution, total }: { distribution: Record<string, number>; total: number }) {
  return (
    <div className="space-y-1.5">
      {[5, 4, 3, 2, 1].map((s) => {
        const n = distribution[String(s)] ?? 0;
        const pct = total > 0 ? (n / total) * 100 : 0;
        return (
          <div key={s} className="flex items-center gap-2 text-xs">
            <span className="w-6 shrink-0 tabular text-muted-foreground">{s}★</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <motion.div className="h-full rounded-full bg-amber-400" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} />
            </div>
            <span className="w-12 shrink-0 text-right tabular text-muted-foreground">{n.toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = { open: "Open now", close: "Closed now", temporarily_closed: "Temporarily closed", closed_forever: "Permanently closed" };

export function ProfileResult({ result, onUse }: { result: unknown; onUse: UseBusiness }) {
  const p = rec(rec(result)?.profile);
  if (!p) return <NoResults title="No Google Business Profile found" description="Google has no profile for this identifier at this location. Try the CID or place ID from Business search." />;
  const { value, votes } = ratingOf(p);
  const distObj = rec(p.rating_distribution);
  const distribution: Record<string, number> = {};
  for (const s of ["1", "2", "3", "4", "5"]) distribution[s] = num(distObj?.[s]) ?? 0;
  const distTotal = Object.values(distribution).reduce((a, b) => a + b, 0);
  const workHours = rec(rec(p.work_time)?.work_hours);
  const timetable = rec(workHours?.timetable);
  const status = str(workHours?.current_status);
  const topics = rec(p.place_topics);
  const topicList = topics ? Object.entries(topics).filter((e): e is [string, number] => typeof e[1] === "number").sort((a, b) => b[1] - a[1]).slice(0, 12) : [];
  const alsoSearch = recs(p.people_also_search).slice(0, 8);
  const addressInfo = rec(p.address_info);
  const checkUrl = str(p.check_url);
  return (
    <motion.div {...fadeIn} className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h3 className="text-lg font-semibold tracking-tight">{str(p.title) ?? "Business"}</h3>
          <p className="text-sm text-muted-foreground">{categoriesOf(p) || "—"}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <ClaimedBadge value={bool(p.is_claimed)} />
            {status && (
              <Badge variant="outline" className={cn(status === "open" ? "text-success" : status === "closed_forever" ? "text-destructive" : "text-muted-foreground")}>
                {STATUS_LABEL[status] ?? status}
              </Badge>
            )}
            {str(p.price_level) && <Badge variant="outline">{str(p.price_level)}</Badge>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {checkUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={checkUrl} target="_blank" rel="noopener noreferrer nofollow">
                <MapPin /> Google Maps <ExternalLink className="size-3 opacity-50" />
              </a>
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled={num(p.latitude) == null} onClick={() => onUse(pickBusiness(p), "rank_grid")}>
            <Crosshair /> Rank grid
          </Button>
        </div>
      </div>

      <KpiStrip
        items={[
          { key: "rating", label: "Rating", value: value != null ? value.toFixed(1) : "—", sub: <Stars value={value} size="size-3" /> },
          { key: "votes", label: "Reviews", value: votes != null ? formatNumber(votes, { maximumFractionDigits: 0 }) : "—" },
          { key: "photos", label: "Photos", value: num(p.total_photos) != null ? formatNumber(num(p.total_photos), { maximumFractionDigits: 0 }) : "—" },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border p-4">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Contact</div>
          <div className="space-y-2 text-sm">
            <div className="flex gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>{str(p.address) ?? ([str(addressInfo?.address), str(addressInfo?.city), str(addressInfo?.zip)].filter(Boolean).join(", ") || "—")}</span>
            </div>
            <div className="flex gap-2">
              <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="tabular">{str(p.phone) ?? "—"}</span>
            </div>
            <div className="flex gap-2">
              <ExternalLink className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <ExternalUrl href={website(p)} label={str(p.domain) ?? undefined} />
            </div>
            <div className="flex gap-2">
              <ImageIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>{num(p.total_photos) != null ? `${num(p.total_photos)} photos` : "—"}</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1 border-t pt-3 text-[11px] text-muted-foreground">
            <span>
              CID <code className="text-foreground">{cidOf(p) ?? "—"}</code>
            </span>
            <span className="break-all">
              Place ID <code className="text-foreground">{str(p.place_id) ?? "—"}</code>
            </span>
          </div>
        </div>
        <div className="space-y-3 rounded-xl border p-4">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Rating breakdown</div>
          {distTotal > 0 ? <DistributionBars distribution={distribution} total={distTotal} /> : <p className="text-sm text-muted-foreground">No rating distribution available.</p>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Clock className="size-3.5" /> Opening hours
          </div>
          {timetable ? (
            <table className="w-full text-sm">
              <tbody>
                {WEEKDAYS.map((d) => {
                  const slots = recs(timetable[d]);
                  return (
                    <tr key={d} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 capitalize text-muted-foreground">{d}</td>
                      <td className="py-1.5 text-right tabular">
                        {slots.length === 0 ? "Closed" : slots.map((s) => `${hhmm(s.open) ?? "?"}–${hhmm(s.close) ?? "?"}`).join(", ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No opening hours listed.</p>
          )}
        </div>
        <div className="space-y-3 rounded-xl border p-4">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Mentioned in reviews</div>
          {topicList.length ? (
            <div className="flex flex-wrap gap-1.5">
              {topicList.map(([topic, count]) => (
                <span key={topic} className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2.5 text-xs">
                  {topic} <span className="text-muted-foreground tabular">{count}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No review topics available.</p>
          )}
          {str(p.description) && <p className="border-t pt-3 text-sm text-muted-foreground">{str(p.description)}</p>}
        </div>
      </div>

      {alsoSearch.length > 0 && (
        <div className="space-y-2 rounded-xl border p-4">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">People also search for</div>
          <ul className="divide-y">
            {alsoSearch.map((c, i) => (
              <li key={`${cidOf(c) ?? i}`} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{str(c.title) ?? "—"}</span>
                <RatingCell row={c} />
                <Button variant="ghost" size="xs" disabled={!cidOf(c)} onClick={() => onUse({ title: str(c.title), cid: cidOf(c), placeId: null, latitude: null, longitude: null }, "business_profile")}>
                  Profile
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
}

/* ───────────────────────────── Reviews ───────────────────────────── */

function reviewRating(row: Rec): number | null {
  const r = rec(row.rating);
  return num(r?.value) ?? num(row.rating);
}

const REVIEW_HEADERS = ["#", "Rating", "Author", "Local guide", "When", "Timestamp", "Review", "Owner answer", "Source", "Review ID"];

export function ReviewsResult({ result }: { result: unknown }) {
  const r = rec(result);
  const reviews = recs(r?.reviews);
  const totals = rec(r?.totals);
  const [stars, setStars] = useState<string>("all");
  const histogram = useMemo(() => {
    const h: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    for (const rv of reviews) {
      const v = reviewRating(rv);
      if (v != null) h[String(Math.min(5, Math.max(1, Math.round(v))))]! += 1;
    }
    return h;
  }, [reviews]);
  const shown = stars === "all" ? reviews : reviews.filter((rv) => Math.round(reviewRating(rv) ?? 0) === Number(stars));
  const totalRating = ratingOf(totals ?? {});
  const extended = str(r?.source) === "extended_reviews";
  const exportRows = () =>
    reviews.map((rv) => [
      num(rv.rank_absolute),
      reviewRating(rv),
      str(rv.profile_name),
      bool(rv.local_guide) ? "yes" : "",
      str(rv.time_ago),
      str(rv.timestamp),
      str(rv.review_text) ?? str(rv.original_review_text),
      str(rv.owner_answer),
      str(rv.source),
      str(rv.review_id),
    ]);
  return (
    <motion.div {...fadeIn} className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{str(totals?.title) ?? "Reviews"}</h3>
          <p className="text-xs text-muted-foreground">
            {extended ? "Google + other review sites" : "Google reviews"} · {reviews.length} collected
          </p>
        </div>
        <ExportMenu disabled={!reviews.length} getData={() => ({ headers: REVIEW_HEADERS, rows: exportRows(), filename: "google-reviews" })} />
      </div>
      <KpiStrip
        items={[
          { key: "rating", label: "Overall rating", value: totalRating.value != null ? totalRating.value.toFixed(1) : "—", sub: <Stars value={totalRating.value} size="size-3" /> },
          { key: "count", label: "Total reviews", value: num(totals?.reviews_count) != null ? formatNumber(num(totals?.reviews_count), { maximumFractionDigits: 0 }) : totalRating.votes != null ? formatNumber(totalRating.votes, { maximumFractionDigits: 0 }) : "—" },
          { key: "fetched", label: "Collected", value: reviews.length.toLocaleString() },
          {
            key: "answered",
            label: "Owner answered",
            value: reviews.length ? `${Math.round((reviews.filter((rv) => str(rv.owner_answer)).length / reviews.length) * 100)}%` : "—",
          },
        ]}
      />
      {reviews.length > 0 && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,15rem)_1fr]">
          <div className="space-y-2 rounded-xl border p-4">
            <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Collected reviews by rating</div>
            <DistributionBars distribution={histogram} total={reviews.length} />
          </div>
          <div className="flex flex-col justify-center gap-2 rounded-xl border p-4">
            <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Filter</div>
            <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={stars} onValueChange={(v) => v && setStars(v)} className="w-full flex-wrap">
              <ToggleGroupItem value="all" className="flex-1 text-xs">
                All
              </ToggleGroupItem>
              {["5", "4", "3", "2", "1"].map((s) => (
                <ToggleGroupItem key={s} value={s} className="flex-1 text-xs">
                  {s}★ <span className="text-muted-foreground tabular">{histogram[s]}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      )}
      {shown.length === 0 ? (
        <NoResults title={reviews.length ? "No reviews with this rating" : "No reviews found"} description={reviews.length ? undefined : "The business has no reviews yet, or Google returned none for this identifier."} />
      ) : (
        <ul className="space-y-2">
          {shown.map((rv, i) => {
            const text = str(rv.review_text) ?? str(rv.original_review_text);
            const highlights = recs(rv.review_highlights);
            return (
              <li key={str(rv.review_id) ?? i} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-full bg-muted">
                    <UserRound className="size-3.5 text-muted-foreground" />
                  </span>
                  <span className="text-sm font-medium">{str(rv.profile_name) ?? "Anonymous"}</span>
                  {bool(rv.local_guide) && (
                    <Badge variant="secondary" className="h-5 text-[10px]">
                      Local Guide
                    </Badge>
                  )}
                  {str(rv.source) && extended && (
                    <Badge variant="outline" className="h-5 text-[10px]">
                      {str(rv.source)}
                    </Badge>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    <Stars value={reviewRating(rv)} size="size-3" />
                    <span className="text-xs text-muted-foreground">{str(rv.time_ago) ?? ""}</span>
                  </span>
                </div>
                {text ? <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{text}</p> : <p className="mt-2 text-sm text-muted-foreground italic">Rating without text.</p>}
                {highlights.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {highlights.map((h, j) => (
                      <span key={j} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                        {str(h.feature)}
                        {str(h.assessment) ? `: ${str(h.assessment)}` : ""}
                      </span>
                    ))}
                  </div>
                )}
                {str(rv.owner_answer) && (
                  <div className="mt-3 rounded-lg border-l-2 border-brand bg-muted/50 px-3 py-2">
                    <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                      <MessageSquareReply className="size-3" /> Owner response {str(rv.owner_time_ago) ? `· ${str(rv.owner_time_ago)}` : ""}
                    </div>
                    <p className="text-sm whitespace-pre-line">{str(rv.owner_answer)}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}

/* ───────────────────────────── Q&A ───────────────────────────── */

export function QuestionsResult({ result }: { result: unknown }) {
  const questions = recs(rec(result)?.questions);
  const answered = questions.filter((q) => recs(q.items).length > 0).length;
  const exportRows = () =>
    questions.flatMap((q) => {
      const answers = recs(q.items);
      const base = [str(q.question_text) ?? str(q.original_question_text), str(q.profile_name), str(q.time_ago)];
      return answers.length ? answers.map((a) => [...base, str(a.answer_text) ?? str(a.original_answer_text), str(a.profile_name), str(a.time_ago)]) : [[...base, "", "", ""]];
    });
  return (
    <motion.div {...fadeIn} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <KpiStrip
          className="flex-1"
          items={[
            { key: "q", label: "Questions", value: questions.length.toLocaleString() },
            { key: "a", label: "Answered", value: answered.toLocaleString() },
            { key: "u", label: "Unanswered", value: (questions.length - answered).toLocaleString() },
          ]}
        />
        <ExportMenu disabled={!questions.length} getData={() => ({ headers: ["Question", "Asked by", "When", "Answer", "Answered by", "Answered"], rows: exportRows(), filename: "google-business-questions" })} />
      </div>
      {questions.length === 0 ? (
        <NoResults title="No questions on this profile" description="Nobody has asked a question on this Google Business Profile yet." />
      ) : (
        <ul className="space-y-2">
          {questions.map((q, i) => {
            const answers = recs(q.items);
            return (
              <li key={str(q.question_id) ?? i} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium">{str(q.question_text) ?? str(q.original_question_text) ?? "—"}</p>
                  {answers.length === 0 && (
                    <Badge variant="outline" className="shrink-0 text-warning">
                      Unanswered
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {str(q.profile_name) ?? "Anonymous"}
                  {str(q.time_ago) ? ` · ${str(q.time_ago)}` : ""}
                </p>
                {answers.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {answers.map((a, j) => (
                      <li key={str(a.answer_id) ?? j} className="rounded-lg bg-muted/50 px-3 py-2">
                        <p className="text-sm whitespace-pre-line">{str(a.answer_text) ?? str(a.original_answer_text) ?? "—"}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {str(a.profile_name) ?? "Anonymous"}
                          {str(a.time_ago) ? ` · ${str(a.time_ago)}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}

/* ───────────────────────────── Posts ───────────────────────────── */

export function PostsResult({ result }: { result: unknown }) {
  const r = rec(result);
  const posts = recs(r?.posts);
  const title = str(rec(r?.totals)?.title);
  const exportRows = () => posts.map((p) => [str(p.post_date) ?? str(p.timestamp), str(p.author), str(p.post_text) ?? str(p.snippet), str(p.url)]);
  return (
    <motion.div {...fadeIn} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{title ?? "Business posts"}</h3>
          <p className="text-xs text-muted-foreground">
            {posts.length} post{posts.length === 1 ? "" : "s"}
          </p>
        </div>
        <ExportMenu disabled={!posts.length} getData={() => ({ headers: ["Date", "Author", "Text", "URL"], rows: exportRows(), filename: "google-business-posts" })} />
      </div>
      {posts.length === 0 ? (
        <NoResults title="No posts found" description="This business hasn't published Google Business updates recently." />
      ) : (
        <ol className="relative space-y-3 border-l pl-5">
          {posts.map((p, i) => {
            const links = recs(p.links);
            return (
              <li key={i} className="relative">
                <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-background bg-brand" />
                <div className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="tabular">{str(p.post_date) ?? str(p.timestamp) ?? "—"}</span>
                    {str(p.author) && <span>· {str(p.author)}</span>}
                    {str(p.url) && <ExternalUrl href={str(p.url)} label="View post" className="ml-auto text-xs" maxWidth="max-w-40" />}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{str(p.post_text) ?? str(p.snippet) ?? "—"}</p>
                  {links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {links.map((l, j) => (
                        <ExternalUrl key={j} href={str(l.url)} label={str(l.title) ?? str(l.type) ?? str(l.url)} className="text-xs" maxWidth="max-w-56" />
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </motion.div>
  );
}
