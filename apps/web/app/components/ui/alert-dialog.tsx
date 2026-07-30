"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { cn } from "~/lib/utils"

/** House AlertDialog (personal-notes A19/CF-47): destructive confirms.
 * Radix handles focus (initial focus → Cancel via ref), Esc = cancel, and
 * focus-return to the trigger — it deliberately does NOT enter the escape
 * registry (double-close hazard). Entrance motion is motion-safe: only. */

function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
	return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger(props: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
	return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

function AlertDialogContent({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
	return (
		<AlertDialogPrimitive.Portal>
			<AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0" />
			<AlertDialogPrimitive.Content
				className={cn(
					"fixed left-1/2 top-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-rule bg-panel p-6 shadow-lg outline-none motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95",
					className,
				)}
				{...props}
			/>
		</AlertDialogPrimitive.Portal>
	)
}

function AlertDialogTitle({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
	return (
		<AlertDialogPrimitive.Title
			className={cn("font-display text-lg font-medium tracking-tight text-ink", className)}
			{...props}
		/>
	)
}

function AlertDialogDescription({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
	return (
		<AlertDialogPrimitive.Description
			className={cn("mt-2 font-reading text-sm leading-relaxed text-muted-foreground", className)}
			{...props}
		/>
	)
}

function AlertDialogCancel({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
	return (
		<AlertDialogPrimitive.Cancel
			className={cn(
				"min-h-9 rounded-md border border-rule2 px-3 font-ui text-sm font-semibold text-ink outline-none transition-colors duration-150 hover:border-primary focus-visible:ring-3 focus-visible:ring-ring/50",
				className,
			)}
			{...props}
		/>
	)
}

function AlertDialogAction({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
	return (
		<AlertDialogPrimitive.Action
			className={cn(
				"min-h-9 rounded-md bg-destructive px-3 font-ui text-sm font-semibold text-white outline-none transition-opacity duration-150 hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50",
				className,
			)}
			{...props}
		/>
	)
}

export {
	AlertDialog,
	AlertDialogTrigger,
	AlertDialogContent,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogCancel,
	AlertDialogAction,
}
