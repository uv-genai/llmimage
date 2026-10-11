import { useCallback, useEffect, useRef, useState } from 'react';
import { Brush, ImagePlus, Link2, Star, Trash2, Upload, X } from 'lucide-react';
import { MAX_REFERENCE_IMAGES } from '../lib/presets';
import { formatBytes } from '../lib/format';
import type { Studio } from '../lib/useStudio';
import { urlToReference } from '../lib/images';
import { useToast } from './ui';

/** Upload surface for the multipart endpoints: drop, pick, paste, mask. */
export function Uploads({ studio }: { studio: Studio }) {
  const { images, addFiles, removeImage, clearImages, makePrimary, mask, clearMask, openMaskEditor } = studio;
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      if (event.dataTransfer.files?.length) void addFiles(event.dataTransfer.files);
    },
    [addFiles],
  );

  // Ctrl/Cmd+V of a screenshot straight into the canvas is the fastest way to iterate.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
      if (!files.length) return;
      event.preventDefault();
      void addFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const addFromUrl = useCallback(async () => {
    const url = window.prompt('Fetch an image into the edit inputs (URL)');
    if (!url) return;
    try {
      const reference = await urlToReference(url, url.split('/').pop() || 'image.png');
      await addFiles([new File([reference.blob], reference.name, { type: reference.blob.type || 'image/png' })]);
    } catch (error) {
      toast.push({ kind: 'error', title: 'Could not fetch that URL', detail: (error as Error).message });
    }
  }, [addFiles, toast]);

  return (
    <div className="space-y-2">
      <div className="label">
        <span>Input images {images.length ? `(${images.length}/${MAX_REFERENCE_IMAGES})` : ''}</span>
        {images.length ? (
          <span className="flex items-center gap-1">
            <button type="button" className="btn btn-ghost btn-icon" title="Add from URL" onClick={() => void addFromUrl()}>
              <Link2 size={12} />
            </button>
            <button type="button" className="btn btn-ghost btn-icon" title="Remove all" onClick={clearImages}>
              <Trash2 size={12} />
            </button>
          </span>
        ) : null}
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
        }}
        className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed px-3 py-5 text-center transition-colors"
        style={{
          borderColor: dragging ? 'var(--accent-2)' : 'var(--border-strong)',
          background: dragging ? 'color-mix(in oklab, var(--accent-2) 12%, transparent)' : 'var(--sunken)',
        }}
      >
        <Upload size={16} style={{ color: dragging ? 'var(--accent-2)' : 'var(--faint)' }} />
        <p className="text-[12.5px] font-medium">{dragging ? 'Drop to add' : 'Drop images, click, or paste'}</p>
        <p className="hint">PNG · JPEG · WebP · first image is the primary reference</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) void addFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {images.length ? (
        <ul className="grid grid-cols-3 gap-2">
          {images.map((image, index) => (
            <li
              key={image.id}
              className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--sunken)]"
              title={`${image.name} · ${image.width}×${image.height}`}
            >
              <div className="checker aspect-square">
                <img src={image.previewUrl} alt={image.name} className="h-full w-full object-contain" />
              </div>
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4">
                <span className="truncate text-[9.5px] font-medium text-white/90">{image.name}</span>
                {index === 0 ? <Star size={10} fill="currentColor" style={{ color: 'var(--accent-2)' }} /> : null}
              </div>
              <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                {index !== 0 ? (
                  <button
                    type="button"
                    className="grid h-5 w-5 place-items-center rounded-md bg-black/65 text-white"
                    title="Make primary"
                    onClick={() => makePrimary(image.id)}
                  >
                    <Star size={10} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="grid h-5 w-5 place-items-center rounded-md bg-black/65 text-white"
                  title="Paint mask on this image"
                  onClick={() => openMaskEditor(image)}
                >
                  <Brush size={10} />
                </button>
                <button
                  type="button"
                  className="grid h-5 w-5 place-items-center rounded-md bg-black/65 text-white"
                  title="Remove"
                  onClick={() => removeImage(image.id)}
                >
                  <X size={10} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn flex-1"
          onClick={() => openMaskEditor(images[0])}
          disabled={!images.length}
          title={images.length ? 'Paint where the model may change' : 'Add an image first'}
        >
          <Brush size={13} /> {mask ? 'Edit mask' : 'Paint mask'}
        </button>
        <button type="button" className="btn" onClick={clearMask} disabled={!mask} title="Remove the mask">
          Clear mask
        </button>
      </div>

      {mask ? (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--sunken)] p-2">
          <img
            src={mask.previewUrl}
            alt="mask preview"
            className="checker h-10 w-10 rounded-md border border-[var(--border)] object-cover"
          />
          <div className="min-w-0">
            <p className="text-[11.5px] font-medium">Mask attached · {formatBytes(mask.blob.size)}</p>
            <p className="hint">Transparent pixels of this PNG are the region the model regenerates.</p>
          </div>
        </div>
      ) : (
        <p className="hint flex items-start gap-1.5">
          <ImagePlus size={12} className="mt-0.5 shrink-0" />
          No mask: the whole image is editable. Masks are optional and only sent with edits.
        </p>
      )}
    </div>
  );
}
