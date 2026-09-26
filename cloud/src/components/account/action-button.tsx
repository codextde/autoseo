"use client";

import { useTransition, type ComponentProps, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type Result = { error?: string; message?: string } | void;

/** Button that runs a server action, shows a spinner and toasts the result. Redirects are followed. */
export function ActionButton({
  action,
  children,
  confirm,
  icon,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "children"> & {
  action: () => Promise<Result>;
  children: ReactNode;
  confirm?: string;
  icon?: ReactNode;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      {...props}
      disabled={pending || props.disabled}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const res = await action();
          if (res?.error) toast.error(res.error);
          else if (res?.message) toast.success(res.message);
        });
      }}
    >
      {pending ? <Spinner /> : icon}
      {children}
    </Button>
  );
}
