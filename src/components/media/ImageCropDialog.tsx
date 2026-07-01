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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { cropImage, prepareImage } from './imageCropUtils';

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 0.2;
const CONTAINER_STYLE = {
    containerStyle: { borderRadius: '0.5rem' }
} as const;

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
    const cropWrapperRef = useRef<HTMLDivElement | null>(null);

    const [previewSrc, setPreviewSrc] = useState<string>('');
    const [cropperReady, setCropperReady] = useState(false);
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(ZOOM_MIN);
    const [rotation, setRotation] = useState(0);
    const [flipH, setFlipH] = useState(false);
    const [flipV, setFlipV] = useState(false);
    const [fitWhole, setFitWhole] = useState(false);
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

    const resetTransforms = useCallback(() => {
        setCrop({ x: 0, y: 0 });
        setZoom(ZOOM_MIN);
        setRotation(0);
        setFlipH(false);
        setFlipV(false);
        setFitWhole(false);
    }, []);

    useEffect(() => {
        resetTransforms();
        setCroppedAreaPixels(null);
        if (!open || !file || !validateImageUploadFile(file).ok) {
            setPreviewSrc('');
            originalImgRef.current = null;
            previewScaleRef.current = 1;
            return;
        }

        let cancelled = false;
        prepareImage(file)
            .then(({ img, previewSrc: src, previewScale }) => {
                if (cancelled) return;
                originalImgRef.current = img;
                previewScaleRef.current = previewScale;
                setPreviewSrc(src);
            })
            .catch(() => {
                if (!cancelled) setPreviewSrc('');
            });

        return () => {
            cancelled = true;
        };
    }, [file, open, resetTransforms]);

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

    // Mount the cropper only after the dialog open animation settles: it measures
    // its container via getBoundingClientRect, which is wrong mid transform-scale.
    useEffect(() => {
        if (!open || !previewSrc) {
            setCropperReady(false);
            return undefined;
        }
        let raf = 0;
        let lastWidth = -1;
        let stableFrames = 0;
        const tick = () => {
            const width =
                cropWrapperRef.current?.getBoundingClientRect().width ?? 0;
            if (width > 0 && Math.abs(width - lastWidth) < 0.5) {
                stableFrames += 1;
                if (stableFrames >= 3) {
                    setCropperReady(true);
                    return;
                }
            } else {
                stableFrames = 0;
                lastWidth = width;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [open, previewSrc]);

    const onCropComplete = useCallback((_croppedArea: Area, pixels: Area) => {
        setCroppedAreaPixels(pixels);
    }, []);

    // toolbar

    const rotateBy = useCallback(
        (delta: number) =>
            setRotation((r) => (((r + delta) % 360) + 360) % 360),
        []
    );
    const rotateLeft = useCallback(() => rotateBy(-90), [rotateBy]);
    const rotateRight = useCallback(() => rotateBy(90), [rotateBy]);
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
    const toggleFit = useCallback(() => {
        setFitWhole((f) => !f);
        setZoom(ZOOM_MIN);
        setCrop({ x: 0, y: 0 });
    }, []);
    const reset = resetTransforms;

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

    const mediaTransform = useMemo(
        () =>
            [
                `translate(${crop.x}px, ${crop.y}px)`,
                `rotateZ(${rotation}deg)`,
                `rotateY(${flipH ? 180 : 0}deg)`,
                `rotateX(${flipV ? 180 : 0}deg)`,
                `scale(${zoom})`
            ].join(' '),
        [crop.x, crop.y, rotation, flipH, flipV, zoom]
    );

    const fitLabel = t(
        fitWhole ? 'dialog.image_crop.mode_free' : 'dialog.image_crop.mode_fit'
    );

    const tools = [
        {
            key: 'rotate_left',
            onClick: rotateLeft,
            label: t('dialog.image_crop.rotate_left'),
            icon: <RotateCcw className="h-4 w-4" />
        },
        {
            key: 'rotate_right',
            onClick: rotateRight,
            label: t('dialog.image_crop.rotate_right'),
            icon: <RotateCw className="h-4 w-4" />
        },
        {
            key: 'flip_h',
            onClick: doFlipH,
            label: t('dialog.image_crop.flip_h'),
            icon: <FlipHorizontal2 className="h-4 w-4" />
        },
        {
            key: 'flip_v',
            onClick: doFlipV,
            label: t('dialog.image_crop.flip_v'),
            icon: <FlipVertical2 className="h-4 w-4" />
        },
        {
            key: 'zoom_in',
            onClick: zoomIn,
            label: t('dialog.image_crop.zoom_in'),
            icon: <ZoomIn className="h-4 w-4" />
        },
        {
            key: 'zoom_out',
            onClick: zoomOut,
            label: t('dialog.image_crop.zoom_out'),
            icon: <ZoomOut className="h-4 w-4" />
        },
        {
            key: 'fit',
            onClick: toggleFit,
            label: fitLabel,
            icon: fitWhole ? (
                <Minimize2 className="h-4 w-4" />
            ) : (
                <Maximize2 className="h-4 w-4" />
            )
        },
        {
            key: 'reset',
            onClick: reset,
            label: t('dialog.image_crop.reset'),
            icon: <RefreshCcw className="h-4 w-4" />
        }
    ];

    // render

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{resolvedTitle}</DialogTitle>
                    <DialogDescription>{resolvedDescription}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    {/* Crop box == container so fit mode letterboxes to the crop aspect */}
                    <div
                        ref={cropWrapperRef}
                        className="bg-muted flex justify-center overflow-hidden rounded-lg border"
                        style={{ minHeight: '30vh' }}
                    >
                        {previewSrc && cropperReady ? (
                            <div
                                style={{
                                    position: 'relative',
                                    aspectRatio: String(aspect),
                                    width: `min(100%, calc(50vh * ${aspect}))`
                                }}
                            >
                                <Cropper
                                    image={previewSrc}
                                    crop={crop}
                                    zoom={zoom}
                                    rotation={rotation}
                                    aspect={aspect}
                                    minZoom={ZOOM_MIN}
                                    maxZoom={ZOOM_MAX}
                                    objectFit={fitWhole ? 'contain' : 'cover'}
                                    restrictPosition={!fitWhole}
                                    showGrid
                                    zoomWithScroll
                                    onCropChange={setCrop}
                                    onZoomChange={setZoom}
                                    onCropComplete={onCropComplete}
                                    transform={mediaTransform}
                                    style={CONTAINER_STYLE}
                                />
                            </div>
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
                            {tools.map((tool) => (
                                <Button
                                    key={tool.key}
                                    variant="outline"
                                    size="icon"
                                    onClick={tool.onClick}
                                    disabled={!previewSrc}
                                    title={tool.label}
                                    aria-label={tool.label}
                                >
                                    {tool.icon}
                                </Button>
                            ))}
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
