import {
    FlipHorizontal2,
    FlipVertical2,
    RefreshCcw,
    ZoomIn,
    ZoomOut
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { validateImageUploadFile } from '@/shared/utils/imageUpload';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

const SCALE_MIN = 1;
const SCALE_MAX = 8;
const SCALE_BTN = 1.25;
const CANVAS_H = 440;
const OVERLAY = 'rgba(0,0,0,0.45)';
const S_BORDER = 'rgba(255,255,255,0.9)';
const S_GRID = 'rgba(255,255,255,0.30)';
const HANDLE = 16;

interface View {
    offsetX: number;
    offsetY: number;
    scale: number;
    flipH: boolean;
    flipV: boolean;
}
const DEFAULT_VIEW: View = {
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    flipH: false,
    flipV: false
};

// geometry

function stencilRect(cw: number, ch: number, aspect: number) {
    const pad = 32;
    let w = cw - pad * 2;
    let h = w / aspect;
    if (h > ch - pad * 2) {
        h = ch - pad * 2;
        w = h * aspect;
    }
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

function coverScale(nw: number, nh: number, sw: number, sh: number) {
    return Math.max(sw / nw, sh / nh);
}

function clampOffset(
    ox: number,
    oy: number,
    rw: number,
    rh: number,
    s: { x: number; y: number; w: number; h: number },
    cw: number,
    ch: number
) {
    const sl = s.x - cw / 2,
        sr = s.x + s.w - cw / 2;
    const st = s.y - ch / 2,
        sb = s.y + s.h - ch / 2;
    return {
        offsetX: Math.min(sl + rw / 2, Math.max(sr - rw / 2, ox)),
        offsetY: Math.min(st + rh / 2, Math.max(sb - rh / 2, oy))
    };
}

// drawing

function drawFrame(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    view: View,
    aspect: number,
    cw: number,
    ch: number
) {
    ctx.clearRect(0, 0, cw, ch);
    const s = stencilRect(cw, ch, aspect);
    const base = coverScale(img.naturalWidth, img.naturalHeight, s.w, s.h);
    const rw = img.naturalWidth * base * view.scale;
    const rh = img.naturalHeight * base * view.scale;
    const cx = cw / 2 + view.offsetX;
    const cy = ch / 2 + view.offsetY;

    // image
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(view.flipH ? -1 : 1, view.flipV ? -1 : 1);
    ctx.drawImage(img, -rw / 2, -rh / 2, rw, rh);
    ctx.restore();

    // overlay
    ctx.fillStyle = OVERLAY;
    ctx.fillRect(0, 0, cw, s.y);
    ctx.fillRect(0, s.y + s.h, cw, ch - s.y - s.h);
    ctx.fillRect(0, s.y, s.x, s.h);
    ctx.fillRect(s.x + s.w, s.y, cw - s.x - s.w, s.h);

    // thirds grid
    ctx.strokeStyle = S_GRID;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
        const gx = s.x + (s.w * i) / 3;
        ctx.moveTo(gx, s.y);
        ctx.lineTo(gx, s.y + s.h);
        const gy = s.y + (s.h * i) / 3;
        ctx.moveTo(s.x, gy);
        ctx.lineTo(s.x + s.w, gy);
    }
    ctx.stroke();

    // border
    ctx.strokeStyle = S_BORDER;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(s.x, s.y, s.w, s.h);

    // corner handles
    ctx.strokeStyle = S_BORDER;
    ctx.lineWidth = 3;
    const corners = [
        [s.x, s.y, 1, 1],
        [s.x + s.w, s.y, -1, 1],
        [s.x, s.y + s.h, 1, -1],
        [s.x + s.w, s.y + s.h, -1, -1]
    ] as const;
    for (const [hx, hy, dx, dy] of corners) {
        ctx.beginPath();
        ctx.moveTo(hx + dx * HANDLE, hy);
        ctx.lineTo(hx, hy);
        ctx.lineTo(hx, hy + dy * HANDLE);
        ctx.stroke();
    }
}

// export

async function renderCroppedBlob(
    img: HTMLImageElement,
    view: View,
    aspect: number,
    cw: number,
    ch: number
): Promise<Blob> {
    const s = stencilRect(cw, ch, aspect);
    const base = coverScale(img.naturalWidth, img.naturalHeight, s.w, s.h);
    const outW = Math.round(s.w / (base * view.scale));
    const outH = Math.round(s.h / (base * view.scale));
    const imgCx = cw / 2 + view.offsetX;
    const imgCy = ch / 2 + view.offsetY;
    const natOx = (s.x + s.w / 2 - imgCx) / (base * view.scale);
    const natOy = (s.y + s.h / 2 - imgCy) / (base * view.scale);
    const srcX = Math.round(img.naturalWidth / 2 + natOx - outW / 2);
    const srcY = Math.round(img.naturalHeight / 2 + natOy - outH / 2);

    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('Failed to prepare export canvas.');
    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.scale(view.flipH ? -1 : 1, view.flipV ? -1 : 1);
    ctx.drawImage(
        img,
        srcX,
        srcY,
        outW,
        outH,
        -outW / 2,
        -outH / 2,
        outW,
        outH
    );
    ctx.restore();

    return new Promise<Blob>((resolve, reject) => {
        out.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Export failed.'))),
            'image/png'
        );
    });
}

export function ImageCropDialog({
    open,
    title,
    description,
    file,
    aspectRatio = 1,
    noteField,
    cropWhiteBorderField,
    onOpenChange,
    onConfirm
}: any) {
    const { t } = useTranslation();

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const viewRef = useRef<View>(DEFAULT_VIEW);
    const dragRef = useRef<{
        sx: number;
        sy: number;
        ox: number;
        oy: number;
    } | null>(null);

    const [imgReady, setImgReady] = useState(false);
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [view, setViewState] = useState<View>(DEFAULT_VIEW);
    const [note, setNote] = useState('');
    const [cropWhiteBorder, setCropWhiteBorder] = useState(true);
    const [isConfirming, setIsConfirming] = useState(false);

    const resolvedTitle = title || t('message.image.label.crop_image');
    const resolvedDescription =
        description || t('message.image.description.crop_description');
    const noteEnabled = Boolean(noteField);
    const noteMaxLength = Number(noteField?.maxLength) || 32;
    const cropWhiteBorderEnabled = Boolean(cropWhiteBorderField);
    const cropWhiteBorderDefault =
        cropWhiteBorderField?.defaultChecked !== false;
    const aspect = Number(aspectRatio) || 1;

    const setView = useCallback((updater: (prev: View) => View) => {
        setViewState((prev) => {
            const next = updater(prev);
            viewRef.current = next;
            return next;
        });
    }, []);

    // image load

    useEffect(() => {
        setImgReady(false);
        imgRef.current = null;
        if (!open || !file || !validateImageUploadFile(file).ok) {
            setImageUrl(null);
            setView(() => DEFAULT_VIEW);
            return undefined;
        }
        const url = URL.createObjectURL(file);
        setImageUrl(url);
        setView(() => DEFAULT_VIEW);

        const img = new Image();
        img.onload = () => {
            imgRef.current = img;
            setImgReady(true);
        };
        img.src = url;
        return () => {
            URL.revokeObjectURL(url);
            imgRef.current = null;
        };
    }, [file, open, setView]);

    useEffect(() => {
        setNote('');
        setCropWhiteBorder(cropWhiteBorderDefault);
    }, [
        cropWhiteBorderDefault,
        cropWhiteBorderEnabled,
        file,
        noteEnabled,
        open
    ]);

    // canvas draw

    useEffect(() => {
        const canvas = canvasRef.current;
        const img = imgRef.current;
        if (!canvas || !img || !imgReady) return;

        const dpr = window.devicePixelRatio || 1;

        const cw = canvas.offsetWidth || canvas.clientWidth;
        const ch = canvas.offsetHeight || canvas.clientHeight;
        if (cw === 0 || ch === 0) return;

        const wantW = Math.round(cw * dpr);
        const wantH = Math.round(ch * dpr);
        if (canvas.width !== wantW || canvas.height !== wantH) {
            canvas.width = wantW;
            canvas.height = wantH;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.save();
        ctx.scale(dpr, dpr);
        drawFrame(ctx, img, view, aspect, cw, ch);
        ctx.restore();
    }, [view, imgReady, aspect]);

    // pointer drag

    const onPointerDown = useCallback(
        (e: React.PointerEvent<HTMLCanvasElement>) => {
            if (!imgRef.current) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = {
                sx: e.clientX,
                sy: e.clientY,
                ox: viewRef.current.offsetX,
                oy: viewRef.current.offsetY
            };
        },
        []
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent<HTMLCanvasElement>) => {
            if (!dragRef.current || !imgRef.current) return;
            const img = imgRef.current;
            const canvas = e.currentTarget;
            const cw = canvas.offsetWidth,
                ch = canvas.offsetHeight;
            const s = stencilRect(cw, ch, aspect);
            const base = coverScale(
                img.naturalWidth,
                img.naturalHeight,
                s.w,
                s.h
            );
            const v = viewRef.current;
            const rw = img.naturalWidth * base * v.scale;
            const rh = img.naturalHeight * base * v.scale;
            const clamped = clampOffset(
                dragRef.current.ox + (e.clientX - dragRef.current.sx),
                dragRef.current.oy + (e.clientY - dragRef.current.sy),
                rw,
                rh,
                s,
                cw,
                ch
            );
            setView((prev) => ({ ...prev, ...clamped }));
        },
        [aspect, setView]
    );

    const onPointerUp = useCallback(() => {
        dragRef.current = null;
    }, []);

    // wheel zoom

    const onWheel = useCallback(
        (e: React.WheelEvent<HTMLCanvasElement>) => {
            e.preventDefault();
            if (!imgRef.current) return;
            const img = imgRef.current;
            const canvas = e.currentTarget;
            const cw = canvas.offsetWidth,
                ch = canvas.offsetHeight;
            const s = stencilRect(cw, ch, aspect);
            const base = coverScale(
                img.naturalWidth,
                img.naturalHeight,
                s.w,
                s.h
            );
            const factor = e.deltaY < 0 ? SCALE_BTN : 1 / SCALE_BTN;
            setView((prev) => {
                const nextScale = Math.min(
                    SCALE_MAX,
                    Math.max(SCALE_MIN, prev.scale * factor)
                );
                const ratio = nextScale / prev.scale;
                const mx = e.nativeEvent.offsetX - cw / 2;
                const my = e.nativeEvent.offsetY - ch / 2;
                const rawOx = mx + (prev.offsetX - mx) * ratio;
                const rawOy = my + (prev.offsetY - my) * ratio;
                const rw = img.naturalWidth * base * nextScale;
                const rh = img.naturalHeight * base * nextScale;
                return {
                    ...prev,
                    scale: nextScale,
                    ...clampOffset(rawOx, rawOy, rw, rh, s, cw, ch)
                };
            });
        },
        [aspect, setView]
    );

    // toolbar

    const applyZoom = useCallback(
        (factor: number) => {
            const img = imgRef.current;
            const canvas = canvasRef.current;
            if (!img || !canvas) return;
            const cw = canvas.offsetWidth,
                ch = canvas.offsetHeight;
            const s = stencilRect(cw, ch, aspect);
            const base = coverScale(
                img.naturalWidth,
                img.naturalHeight,
                s.w,
                s.h
            );
            setView((prev) => {
                const nextScale = Math.min(
                    SCALE_MAX,
                    Math.max(SCALE_MIN, prev.scale * factor)
                );
                const rw = img.naturalWidth * base * nextScale;
                const rh = img.naturalHeight * base * nextScale;
                return {
                    ...prev,
                    scale: nextScale,
                    ...clampOffset(
                        prev.offsetX,
                        prev.offsetY,
                        rw,
                        rh,
                        s,
                        cw,
                        ch
                    )
                };
            });
        },
        [aspect, setView]
    );

    const flipHorizontal = useCallback(
        () => setView((p) => ({ ...p, flipH: !p.flipH })),
        [setView]
    );
    const flipVertical = useCallback(
        () => setView((p) => ({ ...p, flipV: !p.flipV })),
        [setView]
    );
    const zoomIn = useCallback(() => applyZoom(SCALE_BTN), [applyZoom]);
    const zoomOut = useCallback(() => applyZoom(1 / SCALE_BTN), [applyZoom]);
    const reset = useCallback(() => setView(() => DEFAULT_VIEW), [setView]);

    // confirm

    async function confirmCrop() {
        if (!file || !validateImageUploadFile(file).ok || !imgRef.current)
            return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        setIsConfirming(true);
        try {
            const blob = await renderCroppedBlob(
                imgRef.current,
                viewRef.current,
                aspect,
                canvas.offsetWidth,
                canvas.offsetHeight
            );
            const opts: Record<string, unknown> = {};
            if (noteEnabled) opts.note = note.slice(0, noteMaxLength);
            if (cropWhiteBorderEnabled) opts.cropWhiteBorder = cropWhiteBorder;
            await onConfirm?.(
                blob,
                Object.keys(opts).length > 0 ? opts : undefined
            );
        } finally {
            setIsConfirming(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{resolvedTitle}</DialogTitle>
                    <DialogDescription>{resolvedDescription}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <div className="bg-muted overflow-hidden rounded-lg border">
                        <canvas
                            ref={canvasRef}
                            role="img"
                            aria-label={t(
                                'message.image.success.selected_upload_preview'
                            )}
                            onPointerDown={onPointerDown}
                            onPointerMove={onPointerMove}
                            onPointerUp={onPointerUp}
                            onPointerCancel={onPointerUp}
                            onWheel={onWheel}
                            style={{
                                width: '100%',
                                height: `${CANVAS_H}px`,
                                display: 'block',
                                cursor: imgReady ? 'grab' : 'default',
                                touchAction: 'none'
                            }}
                        />
                    </div>

                    <FieldGroup>
                        <div
                            className="flex flex-wrap items-center justify-center gap-1"
                            role="toolbar"
                            aria-label={t('dialog.image_crop.toolbar_label', {
                                defaultValue: 'Image crop toolbar'
                            })}
                        >
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={flipHorizontal}
                                disabled={!imgReady}
                                title={t('dialog.image_crop.flip_h')}
                                aria-label={t('dialog.image_crop.flip_h')}
                            >
                                <FlipHorizontal2 className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={flipVertical}
                                disabled={!imgReady}
                                title={t('dialog.image_crop.flip_v')}
                                aria-label={t('dialog.image_crop.flip_v')}
                            >
                                <FlipVertical2 className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={zoomIn}
                                disabled={!imgReady}
                                title={t('dialog.image_crop.zoom_in')}
                                aria-label={t('dialog.image_crop.zoom_in')}
                            >
                                <ZoomIn className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={zoomOut}
                                disabled={!imgReady}
                                title={t('dialog.image_crop.zoom_out')}
                                aria-label={t('dialog.image_crop.zoom_out')}
                            >
                                <ZoomOut className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={reset}
                                disabled={!imgReady}
                                title={t('dialog.image_crop.reset')}
                                aria-label={t('dialog.image_crop.reset')}
                            >
                                <RefreshCcw className="h-4 w-4" />
                            </Button>
                        </div>
                    </FieldGroup>

                    {noteEnabled ? (
                        <Field>
                            <FieldLabel htmlFor="image-crop-upload-note">
                                {noteField.label}
                            </FieldLabel>
                            <Input
                                id="image-crop-upload-note"
                                maxLength={noteMaxLength}
                                value={note}
                                onChange={(e) =>
                                    setNote(
                                        String(e.target.value || '').slice(
                                            0,
                                            noteMaxLength
                                        )
                                    )
                                }
                                placeholder={noteField.placeholder}
                            />
                        </Field>
                    ) : null}
                    {cropWhiteBorderEnabled ? (
                        <Field orientation="horizontal" className="h-9 w-auto">
                            <Checkbox
                                id="image-crop-white-border"
                                checked={cropWhiteBorder}
                                onCheckedChange={(v) =>
                                    setCropWhiteBorder(Boolean(v))
                                }
                            />
                            <FieldLabel htmlFor="image-crop-white-border">
                                {cropWhiteBorderField.label}
                            </FieldLabel>
                        </Field>
                    ) : null}
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        disabled={isConfirming}
                        onClick={() => onOpenChange?.(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        disabled={isConfirming || !file}
                        onClick={() => {
                            confirmCrop();
                        }}
                    >
                        {isConfirming ? (
                            <Spinner data-icon="inline-start" />
                        ) : null}
                        {t('message.image.action.upload')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
