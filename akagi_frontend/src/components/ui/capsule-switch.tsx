import * as React from "react"
import {cn} from "@/lib/utils"

interface CapsuleSwitchProps {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    labelOn?: React.ReactNode
    labelOff?: React.ReactNode
    className?: string
    disabled?: boolean
}

export function CapsuleSwitch({
                                  checked,
                                  onCheckedChange,
                                  labelOn = "On",
                                  labelOff = "Off",
                                  className,
                                  disabled = false
                              }: CapsuleSwitchProps) {
    return (
        <div
            className={cn(
                "group relative inline-flex h-9 items-center rounded-full bg-muted border border-input p-1 font-medium ring-offset-background transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                disabled && "cursor-not-allowed opacity-50",
                className
            )}
        >
            <div
                className={cn(
                    "absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-background shadow-sm transition-all duration-300 ease-in-out",
                    checked ? "translate-x-full" : "translate-x-0"
                )}
            />
            <button
                type="button"
                role="switch"
                aria-checked={!checked}
                disabled={disabled}
                onClick={() => onCheckedChange(false)}
                className={cn(
                    "relative z-10 flex min-w-[3rem] flex-1 items-center justify-center rounded-full px-3 py-1 text-sm transition-colors focus-visible:outline-none",
                    !checked ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
            >
                {labelOff}
            </button>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                disabled={disabled}
                onClick={() => onCheckedChange(true)}
                className={cn(
                    "relative z-10 flex min-w-[3rem] flex-1 items-center justify-center rounded-full px-3 py-1 text-sm transition-colors focus-visible:outline-none",
                    checked ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
            >
                {labelOn}
            </button>
        </div>
    )
}
