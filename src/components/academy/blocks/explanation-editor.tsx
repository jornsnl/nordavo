"use client";

import { useEffect, useRef, useState } from "react";
import {
  ImageUp,
  Bold,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  RemoveFormatting,
  type LucideIcon,
} from "lucide-react";
import { explanationHtml } from "@/lib/academy/blocks/types";
import { isSafeUrl, sanitizeHtml } from "@/lib/academy/sanitize";
// Area: media (image upload).
import { reserveImageUpload } from "@/app/dashboard/academy/media-actions";
import { uploadFile } from "@/components/academy/media/upload";
import type { BlockEditorProps } from "./types";

type Command = { label: string; icon: LucideIcon; run: () => void };

function exec(command: string, value?: string) {
  // execCommand is deprecated but still the one cross-browser way to edit
  // contenteditable; the result is sanitized on save and on render.
  document.execCommand(command, false, value);
}

/** Rich text for the explanation block: headings, lists, emphasis, links, images and quotes. */
export function ExplanationEditor({ block, content, onChange, disabled }: BlockEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const initial = useRef(explanationHtml(content));
  // Image upload (media area): the caret is kept while the file dialog is open.
  const fileInput = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [imageStatus, setImageStatus] = useState<string | null>(null);

  function keepSelection() {
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    savedRange.current = range && ref.current?.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
  }

  async function uploadImage(file: File) {
    setImageStatus("Uploading the image…");
    const target = await reserveImageUpload({ fileName: file.name, size: file.size, type: file.type });
    if (!target.ok) {
      setImageStatus(target.error);
      return;
    }
    try {
      await uploadFile({ bucket: target.bucket, path: target.path, signedUrl: target.signedUrl }, file, { contentType: file.type });
    } catch (error) {
      setImageStatus(error instanceof Error ? error.message : "Upload failed.");
      return;
    }
    ref.current?.focus();
    const selection = window.getSelection();
    if (savedRange.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
    exec("insertImage", target.src);
    emit();
    setImageStatus(null);
  }

  // Fill the editor once; afterwards the DOM is the source and React stays out of the way.
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = sanitizeHtml(initial.current);
  }, []);

  function emit() {
    if (ref.current) onChange({ ...content, html: ref.current.innerHTML });
  }

  function run(fn: () => void) {
    ref.current?.focus();
    fn();
    emit();
  }

  const commands: Command[] = [
    { label: "Heading", icon: Heading2, run: () => exec("formatBlock", "<h2>") },
    { label: "Subheading", icon: Heading3, run: () => exec("formatBlock", "<h3>") },
    { label: "Paragraph", icon: Pilcrow, run: () => exec("formatBlock", "<p>") },
    { label: "Bold", icon: Bold, run: () => exec("bold") },
    { label: "Italic", icon: Italic, run: () => exec("italic") },
    { label: "Bulleted list", icon: List, run: () => exec("insertUnorderedList") },
    { label: "Numbered list", icon: ListOrdered, run: () => exec("insertOrderedList") },
    { label: "Quote", icon: Quote, run: () => exec("formatBlock", "<blockquote>") },
    {
      label: "Link",
      icon: Link2,
      run: () => {
        const url = window.prompt("Link address (https://...)");
        if (url && isSafeUrl(url.trim())) exec("createLink", url.trim());
      },
    },
    {
      label: "Image from a link",
      icon: ImageIcon,
      run: () => {
        const url = window.prompt("Image address (https://...)");
        if (url && isSafeUrl(url.trim(), "src")) exec("insertImage", url.trim());
      },
    },
    { label: "Clear formatting", icon: RemoveFormatting, run: () => exec("removeFormat") },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-0.5 border-b border-border bg-surface px-1.5 py-1">
        {commands.map(({ label, icon: Icon, run: action }) => (
          <button
            key={label}
            type="button"
            title={label}
            aria-label={label}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(action)}
            className="flex size-8 items-center justify-center rounded-lg text-muted transition hover:bg-white hover:text-brand-900 disabled:opacity-50 pointer-coarse:size-10"
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        ))}
        <button
          type="button"
          title="Upload an image"
          aria-label="Upload an image"
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault();
            keepSelection();
          }}
          onClick={() => fileInput.current?.click()}
          className="flex size-8 items-center justify-center rounded-lg text-muted transition hover:bg-white hover:text-brand-900 disabled:opacity-50 pointer-coarse:size-10"
        >
          <ImageUp className="size-4" aria-hidden="true" />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadImage(file);
            e.target.value = "";
          }}
        />
      </div>
      {imageStatus && (
        <p className="border-b border-border bg-surface px-3 py-1.5 text-xs text-muted" aria-live="polite">
          {imageStatus}
        </p>
      )}
      <div
        ref={ref}
        id={`explanation-${block.id}`}
        role="textbox"
        aria-multiline="true"
        aria-label="Explanation text"
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          // Pasted HTML from Word or a website is cleaned before it lands.
          e.preventDefault();
          const html = e.clipboardData.getData("text/html");
          const text = e.clipboardData.getData("text/plain");
          exec(
            "insertHTML",
            html
              ? sanitizeHtml(html)
              : sanitizeHtml(
                  text
                    .split(/\n{2,}/)
                    .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`)
                    .join(""),
                ),
          );
          emit();
        }}
        className="academy-prose min-h-40 px-4 py-3 text-sm outline-none"
      />
    </div>
  );
}
