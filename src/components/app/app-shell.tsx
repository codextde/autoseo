import { cookies } from "next/headers";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { Topbar } from "./topbar";
import { ShellProvider, type ShellData } from "./shell-context";
import { TourRunner } from "@/features/tour/components/tour-runner";

export async function AppShell({ data, children }: { data: ShellData; children: React.ReactNode }) {
  const jar = await cookies();
  const defaultOpen = jar.get("sidebar_state")?.value !== "false";
  return (
    <ShellProvider value={data}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar />
        <SidebarInset className="min-w-0 bg-background">
          <Topbar />
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </SidebarInset>
      </SidebarProvider>
      <TourRunner />
    </ShellProvider>
  );
}
