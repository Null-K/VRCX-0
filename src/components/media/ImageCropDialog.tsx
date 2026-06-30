import 'react-easy-crop/react-easy-crop.css';
import {
    FlipHorizontal2,
    FlipVertical2,
    Maximize2,
    Minimize2,
    RefreshCcw,
    RotateCcw,
    RotateCw,
    ZoomIn,
    ZoomOut
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
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

// constants

const MAX_PREVIEW_SIZE = 800;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 0.2;

function applyTransforms(
    img: HTMLImageElement | HTMLCanvasElement,
    angleDeg: number,
    flipH: boolean,
    flipV: boolean
): HTMLCanvasElement {
    const angleRad = (angleDeg * Math.PI) / 180;
    const absCos = Math.abs(Math.cos(angleRad));
    const absSin = Math.abs(Math.sin(angleRad));
    const rotW = Math.round(img.width * absCos + img.height * absSin);
    const rotH = Math.round(img.width * absSin + img.height * absCos);

    const cvs = document.createElement('canvas');
    cvs.width = rotW;
    cvs.height = rotH;
    const ctx = cvs.getContext('2d')!;
    ctx.translate(rotW / 2, rotH / 2);
    ctx.rotate(angleRad);
    if (flipH) ctx.scale(-1, 1);
    if (flipV) ctx.scale(1, -1);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    return cvs;
}

async function cropImage(
    originalImg: HTMLImageElement,
    previewScale: number,
    croppedAreaPixels: Area,
    rotation: number,
    flipH: boolean,
    flipV: boolean,
    originalFile: File
): Promise<Blob> {
    const hasTransform = rotation !== 0 || flipH || flipV;

    const cropX = Math.round(croppedAreaPixels.x / previewScale);
    const cropY = Math.round(croppedAreaPixels.y / previewScale);
    const cropW = Math.round(croppedAreaPixels.width / previewScale);
    const cropH = Math.round(croppedAreaPixels.height / previewScale);

    if (!hasTransform) {
        const noCrop =
            cropX <= 1 &&
            cropY <= 1 &&
            Math.abs(cropW - originalImg.width) <= 1 &&
            Math.abs(cropH - originalImg.height) <= 1;
        if (noCrop) return originalFile;
    }

    const source: HTMLImageElement | HTMLCanvasElement = hasTransform
        ? applyTransforms(originalImg, rotation, flipH, flipV)
        : originalImg;

    const out = document.createElement('canvas');
    out.width = cropW;
    out.height = cropH;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(source, -cropX, -cropY);

    return new Promise<Blob>((resolve, reject) => {
        out.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Export failed.'))),
            'image/png'
        );
    });
}

async function prepareImage(file: File): Promise<{
    img: HTMLImageElement;
    previewSrc: string;
    previewScale: number;
}> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.onload = () => {
            const dataUrl = reader.result as string;
            const img = new Image();
            img.onerror = () => reject(new Error('Failed to decode image.'));
            img.onload = () => {
                const { width, height } = img;
                if (width > MAX_PREVIEW_SIZE || height > MAX_PREVIEW_SIZE) {
                    const scale = Math.min(
                        MAX_PREVIEW_SIZE / width,
                        MAX_PREVIEW_SIZE / height
                    );
                    const cvs = document.createElement('canvas');
                    cvs.width = Math.round(width * scale);
                    cvs.height = Math.round(height * scale);
                    cvs.getContext('2d')!.drawImage(
                        img,
                        0,
                        0,
                        cvs.width,
                        cvs.height
                    );
                    resolve({
                        img,
                        previewSrc: cvs.toDataURL('image/jpeg', 0.9),
                        previewScale: scale
                    });
                } else {
                    resolve({ img, previewSrc: dataUrl, previewScale: 1 });
                }
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    });
}

// component

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

    const originalImgRef = useRef<HTMLImageElement | null>(null);
    const previewScaleRef = useRef<number>(1);

    const [previewSrc, setPreviewSrc] = useState<string>('');
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(ZOOM_MIN);
    const [rotation, setRotation] = useState(0);
    const [flipH, setFlipH] = useState(false);
    const [flipV, setFlipV] = useState(false);
    const [objectFit, setObjectFit] = useState<'contain' | 'cover'>('cover');
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(
        null
    );

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

    useEffect(() => {
        if (!open || !file || !validateImageUploadFile(file).ok) {
            setPreviewSrc('');
            originalImgRef.current = null;
            previewScaleRef.current = 1;
            setCrop({ x: 0, y: 0 });
            setZoom(ZOOM_MIN);
            setRotation(0);
            setFlipH(false);
            setFlipV(false);
            setCroppedAreaPixels(null);
            return;
        }

        let cancelled = false;
        prepareImage(file)
            .then(({ img, previewSrc: src, previewScale }) => {
                if (cancelled) return;
                originalImgRef.current = img;
                previewScaleRef.current = previewScale;
                setPreviewSrc(src);
                setCrop({ x: 0, y: 0 });
                setZoom(ZOOM_MIN);
                setRotation(0);
                setFlipH(false);
                setFlipV(false);
                setCroppedAreaPixels(null);
            })
            .catch(() => {
                if (!cancelled) setPreviewSrc('');
            });

        return () => {
            cancelled = true;
        };
    }, [file, open]);

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

    const onCropComplete = useCallback((_croppedArea: Area, pixels: Area) => {
        setCroppedAreaPixels(pixels);
    }, []);

    // toolbar

    const rotateLeft = useCallback(
        () => setRotation((r) => (((r - 90) % 360) + 360) % 360),
        []
    );
    const rotateRight = useCallback(
        () => setRotation((r) => (r + 90) % 360),
        []
    );
    const doFlipH = useCallback(() => setFlipH((v) => !v), []);
    const doFlipV = useCallback(() => setFlipV((v) => !v), []);
    const zoomIn = useCallback(
        () => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(3))),
        []
    );
    const zoomOut = useCallback(
        () => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(3))),
        []
    );
    const toggleFit = useCallback(
        () => setObjectFit((f) => (f === 'contain' ? 'cover' : 'contain')),
        []
    );
    const reset = useCallback(() => {
        setCrop({ x: 0, y: 0 });
        setZoom(ZOOM_MIN);
        setRotation(0);
        setFlipH(false);
        setFlipV(false);
    }, []);

    // confirm

    async function confirmCrop() {
        const img = originalImgRef.current;
        if (!file || !validateImageUploadFile(file).ok || !img) return;

        const pixels: Area = croppedAreaPixels ?? {
            x: 0,
            y: 0,
            width: img.width * previewScaleRef.current,
            height: img.height * previewScaleRef.current
        };

        setIsConfirming(true);
        try {
            const blob = await cropImage(
                img,
                previewScaleRef.current,
                pixels,
                rotation,
                flipH,
                flipV,
                file
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

    const mediaTransform =
        [flipH ? 'scaleX(-1)' : '', flipV ? 'scaleY(-1)' : '']
            .filter(Boolean)
            .join(' ') || undefined;

    // render

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{resolvedTitle}</DialogTitle>
                    <DialogDescription>{resolvedDescription}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    {/* react-easy-crop requires a positioned parent with explicit height */}
                    <div
                        className="bg-muted overflow-hidden rounded-lg border"
                        style={{ position: 'relative', height: '55vh' }}
                    >
                        {previewSrc ? (
                            <Cropper
                                image={previewSrc}
                                crop={crop}
                                zoom={zoom}
                                rotation={rotation}
                                aspect={aspect}
                                minZoom={ZOOM_MIN}
                                maxZoom={ZOOM_MAX}
                                objectFit={objectFit}
                                showGrid
                                zoomWithScroll
                                onCropChange={setCrop}
                                onZoomChange={setZoom}
                                onCropComplete={onCropComplete}
                                transform={mediaTransform}
                                style={{
                                    containerStyle: { borderRadius: '0.5rem' }
                                }}
                            />
                        ) : null}
                    </div>

                    {/* toolbar */}
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
                                onClick={rotateLeft}
                                disabled={!previewSrc}
                                title={t('dialog.image_crop.rotate_left')}
                                aria-label={t('dialog.image_crop.rotate_left')}
                            >
                                <RotateCcw className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={rotateRight}
                                disabled={!previewSrc}
                                title={t('dialog.image_crop.rotate_right')}
                                aria-label={t('dialog.image_crop.rotate_right')}
                            >
                                <RotateCw className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={doFlipH}
                                disabled={!previewSrc}
                                title={t('dialog.image_crop.flip_h')}
                                aria-label={t('dialog.image_crop.flip_h')}
                            >
                                <FlipHorizontal2 className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={doFlipV}
                                disabled={!previewSrc}
                                title={t('dialog.image_crop.flip_v')}
                                aria-label={t('dialog.image_crop.flip_v')}
                            >
                                <FlipVertical2 className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={zoomIn}
                                disabled={!previewSrc}
                                title={t('dialog.image_crop.zoom_in')}
                                aria-label={t('dialog.image_crop.zoom_in')}
                            >
                                <ZoomIn className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={zoomOut}
                                disabled={!previewSrc}
                                title={t('dialog.image_crop.zoom_out')}
                                aria-label={t('dialog.image_crop.zoom_out')}
                            >
                                <ZoomOut className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={toggleFit}
                                disabled={!previewSrc}
                                title={
                                    objectFit === 'cover'
                                        ? t('dialog.image_crop.mode_fit')
                                        : t('dialog.image_crop.mode_free')
                                }
                                aria-label={
                                    objectFit === 'cover'
                                        ? t('dialog.image_crop.mode_fit')
                                        : t('dialog.image_crop.mode_free')
                                }
                            >
                                {objectFit === 'cover' ? (
                                    <Maximize2 className="h-4 w-4" />
                                ) : (
                                    <Minimize2 className="h-4 w-4" />
                                )}
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={reset}
                                disabled={!previewSrc}
                                title={t('dialog.image_crop.reset')}
                                aria-label={t('dialog.image_crop.reset')}
                            >
                                <RefreshCcw className="h-4 w-4" />
                            </Button>
                        </div>
                    </FieldGroup>

                    {/* optional fields */}
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
