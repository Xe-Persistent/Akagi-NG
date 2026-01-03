import * as React from "react"
import {cn} from "@/lib/utils"

interface SettingsItemProps extends React.HTMLAttributes<HTMLDivElement> {
    label: string
    description?: React.ReactNode
    children?: React.ReactNode
    layout?: "row" | "col"
}

export function SettingsItem({
                                 label,
                                 description,
                                 children,
                                 layout = "col",
                                 className,
                                 ...props
                             }: SettingsItemProps) {
    return (
        <div
            className={cn(
                "group flex w-full",
                layout === "row" ? "items-center justify-between gap-4" : "flex-col gap-2",
                className
            )}
            {...props}
        >
            <div className="flex flex-col gap-0.5">
                <label
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    {label}
                </label>
                {description && (
                    <p className="text-xs text-muted-foreground">
                        {description}
                    </p>
                )}
            </div>
            <div className={cn(layout === "row" ? "flex-shrink-0" : "w-full")}>
                {children}
            </div>
        </div>
    )
}
