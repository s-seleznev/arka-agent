"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function ArkaButton(props: ComponentProps<"button">) {
  const favorite = props.className?.split(" ").includes("favorite");
  const [selected, setSelected] = useState(props["aria-pressed"] === "true" || props["aria-pressed"] === true);
  return <Button {...props} variant="ghost" className={favorite ? `${props.className?.replace(/\bselected\b/g, "")} ${selected ? "selected" : ""}` : props.className} aria-pressed={favorite ? selected : props["aria-pressed"]} onClick={(event) => {
    if (favorite) { event.preventDefault(); event.stopPropagation(); setSelected(!selected); }
    props.onClick?.(event);
  }} />;
}
export function ArkaInput(props: ComponentProps<"input">) { return <Input {...props} />; }
export function ArkaBadge(props: ComponentProps<"span">) { return <Badge {...props} />; }
export function ArkaLink({ href = "#", ...props }: ComponentProps<"a">) {
  return href.startsWith("/arka/") ? <Link href={href} {...props} /> : <a href={href} {...props} />;
}
export function ArkaCheckbox({children, ...props}: ComponentProps<"label">) {
  const [checked, setChecked] = useState(props["aria-checked"] === "true");
  return <CheckboxPrimitive.Root asChild checked={checked} onCheckedChange={(value) => setChecked(value === true)}>
    <label {...props} aria-label={props["aria-label"] ?? "Выбрать строку"} aria-checked={checked} tabIndex={0}>{children}</label>
  </CheckboxPrimitive.Root>;
}
export function ArkaPanel(props: ComponentProps<"div">) { return <div data-slot="arka-panel" {...props} />; }
export function ArkaGridRow(props: ComponentProps<"div">) { return <div data-slot="arka-grid-row" {...props} />; }
export function ArkaGridCell(props: ComponentProps<"div">) { return <div data-slot="arka-grid-cell" {...props} />; }
export function ArkaTable(props: ComponentProps<"table">) { return <table data-slot="arka-table" {...props} />; }
