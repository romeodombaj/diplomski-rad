import { useCallback, useEffect, useRef, useState } from "react";
import { Label } from "@/UI/label";
import { Input } from "@/UI/input";
import { cn } from "@/lib/utils";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/UI/select";
import { Button } from "./button";

// ── FormInput ─────────────────────────────────────────────────────────────────

type FormInputProps = {
    type?: "text" | "email" | "password" | "tel" | "url" | "number";
    value: string | number;
    onChange: (value: string) => void;
    label: string;
    placeholder?: string;
    required?: boolean;
    disabled?: boolean;
    error?: string;
    step?: number | "any";
    decimals?: number;
};

export function FormInput(props: FormInputProps) {
    const {
        label,
        value,
        onChange,
        type = "text",
        placeholder,
        required,
        disabled,
        error,
    } = props;
    const numberProps =
        type === "number"
            ? (props as Extract<FormInputProps, { type: "number" }>)
            : null;
    const step = numberProps?.step;
    const decimals = numberProps?.decimals;

    const [focused, setFocused] = useState(false);

    const displayType =
        type === "number" && decimals !== undefined && !focused ? "text" : type;
    const displayValue =
        type === "number" && decimals !== undefined && !focused
            ? value === "" || isNaN(Number(value))
                ? ""
                : Number(value).toFixed(decimals)
            : value;

    return (
        <div className="space-y-1">
            <Label>{label}</Label>
            <Input
                type={displayType}
                value={displayValue}
                step={step}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onChange={(e) =>
                    type === "number"
                        ? (onChange as (v: number) => void)(
                              e.target.valueAsNumber
                          )
                        : (onChange as (v: string) => void)(e.target.value)
                }
                placeholder={
                    decimals !== undefined
                        ? Number(0).toFixed(decimals)
                        : placeholder ?? label
                }
                required={required}
                disabled={disabled}
                aria-invalid={!!error}
                className={cn(
                    error && "border-destructive focus-visible:ring-destructive"
                )}
            />
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
    );
}

// ── FormTextarea ──────────────────────────────────────────────────────────────

interface FormTextareaProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    rows?: number;
    required?: boolean;
    disabled?: boolean;
    error?: string;
}

export function FormTextarea({
    label,
    value,
    onChange,
    placeholder,
    rows = 4,
    required,
    disabled,
    error,
}: FormTextareaProps) {
    return (
        <div className="col-span-2 space-y-1">
            <Label>{label}</Label>
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder ?? label}
                rows={rows}
                required={required}
                disabled={disabled}
                aria-invalid={!!error}
                className={cn(
                    "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                    error && "border-destructive focus-visible:ring-destructive"
                )}
            />
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
    );
}

// ── FormSelect ────────────────────────────────────────────────────────────────

interface FormSelectProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    placeholder?: string;
    required?: boolean;
    disabled?: boolean;
    error?: string;
}

export function FormSelect({
    label,
    value,
    onChange,
    options,
    placeholder,
    disabled,
    error,
}: FormSelectProps) {
    const selectedLabel = options.find((o) => o.value === value)?.label;
    return (
        <div className="space-y-1">
            <Label>{label}</Label>
            <Select value={value} onValueChange={onChange} disabled={disabled}>
                <SelectTrigger
                    className={cn(
                        error && "border-destructive focus:ring-destructive"
                    )}
                >
                    <SelectValue placeholder={placeholder ?? label}>
                        {selectedLabel}
                    </SelectValue>
                </SelectTrigger>
                <SelectContent>
                    {options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
    );
}

// ── FormCheckbox ──────────────────────────────────────────────────────────────

interface FormCheckboxProps {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    error?: string;
}

export function FormCheckbox({
    label,
    checked,
    onChange,
    disabled,
    error,
}: FormCheckboxProps) {
    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2">
                <input
                    type="checkbox"
                    id={`checkbox-${label}`}
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                    disabled={disabled}
                    className="h-4 w-4 rounded border border-input"
                />
                <Label htmlFor={`checkbox-${label}`}>{label}</Label>
            </div>
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
    );
}

// ── FormRadioGroup ────────────────────────────────────────────────────────────

interface FormRadioGroupProps {
    label: string;
    name: string;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    disabled?: boolean;
    error?: string;
    type?: "radio" | "button";
}

export function FormRadioGroup({
    label,
    name,
    value,
    onChange,
    options,
    disabled,
    error,
    type = "radio",
}: FormRadioGroupProps) {
    return (
        <div className="space-y-1">
            <Label>{label}</Label>
            {type === "button" ? (
                <div className="flex gap-2">
                    {options.map((opt) => (
                        <Button
                            key={opt.value}
                            type="button"
                            onClick={() => onChange(opt.value)}
                            variant={
                                value === opt.value ? "default" : "outline"
                            }
                            className="flex-1"
                            disabled={disabled}
                        >
                            {opt.label}
                        </Button>
                    ))}
                </div>
            ) : (
                <div className="flex flex-wrap gap-4">
                    {options.map((opt) => (
                        <label
                            key={opt.value}
                            className="flex items-center gap-1.5 text-sm cursor-pointer"
                        >
                            <input
                                type="radio"
                                name={name}
                                value={opt.value}
                                checked={value === opt.value}
                                onChange={() => onChange(opt.value)}
                                disabled={disabled}
                                className="h-4 w-4"
                            />
                            {opt.label}
                        </label>
                    ))}
                </div>
            )}
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
    );
}

// ── FormCombobox ──────────────────────────────────────────────────────────────
// Async searchable combobox. Pass fetchOptions to load results as the user types.

interface ComboboxOption {
    value: string;
    label: string;
}

interface FormComboboxProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    fetchOptions: (q: string) => Promise<ComboboxOption[]>;
    placeholder?: string;
    disabled?: boolean;
    error?: string;
}

export function FormCombobox({
    label,
    value,
    onChange,
    fetchOptions,
    placeholder,
    disabled,
    error,
}: FormComboboxProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [options, setOptions] = useState<ComboboxOption[]>([]);
    const [fetching, setFetching] = useState(false);
    const [selectedLabel, setSelectedLabel] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Resolve label for current value on mount / value change
    useEffect(() => {
        if (!value) {
            setSelectedLabel("");
            return;
        }
        fetchOptions("")
            .then((opts) => {
                const found = opts.find((o) => o.value === value);
                if (found) setSelectedLabel(found.label);
            })
            .catch(() => {});
    }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

    // Close on outside click
    useEffect(() => {
        function onDown(e: MouseEvent) {
            if (
                containerRef.current &&
                !containerRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
                setQuery("");
            }
        }
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, []);

    const load = useCallback(
        (q: string) => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                setFetching(true);
                fetchOptions(q)
                    .then(setOptions)
                    .catch(() => setOptions([]))
                    .finally(() => setFetching(false));
            }, 250);
        },
        [fetchOptions]
    );

    function handleFocus() {
        if (disabled) return;
        setOpen(true);
        setQuery("");
        load("");
    }

    function handleSelect(opt: ComboboxOption) {
        onChange(opt.value);
        setSelectedLabel(opt.label);
        setOpen(false);
        setQuery("");
    }

    return (
        <div className="space-y-1" ref={containerRef}>
            <Label>{label}</Label>
            <div className="relative">
                <Input
                    value={open ? query : selectedLabel}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        load(e.target.value);
                    }}
                    onFocus={handleFocus}
                    placeholder={
                        placeholder ?? `Search ${label.toLowerCase()}...`
                    }
                    disabled={disabled}
                    aria-invalid={!!error}
                    aria-expanded={open}
                    aria-autocomplete="list"
                    className={cn(
                        error &&
                            "border-destructive focus-visible:ring-destructive"
                    )}
                />
                {open && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md max-h-56 overflow-y-auto">
                        {fetching ? (
                            <p className="px-3 py-2 text-sm text-muted-foreground">
                                Loading…
                            </p>
                        ) : options.length === 0 ? (
                            <p className="px-3 py-2 text-sm text-muted-foreground">
                                No results
                            </p>
                        ) : (
                            options.map((opt) => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleSelect(opt);
                                    }}
                                    className={cn(
                                        "w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                                        opt.value === value &&
                                            "bg-accent text-accent-foreground font-medium"
                                    )}
                                >
                                    {opt.label}
                                </button>
                            ))
                        )}
                    </div>
                )}
            </div>
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
    );
}

// ── FormFileInput ─────────────────────────────────────────────────────────────

interface FormFileInputProps {
    label: string;
    onChange: (file: File | null) => void;
    accept?: string;
    currentUrl?: string;
    disabled?: boolean;
    error?: string;
}

export function FormFileInput({
    label,
    onChange,
    accept,
    currentUrl,
    disabled,
    error,
}: FormFileInputProps) {
    const [preview, setPreview] = useState<string | null>(currentUrl ?? null);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0] ?? null;
        onChange(file);
        if (file && file.type.startsWith("image/")) {
            setPreview(URL.createObjectURL(file));
        } else {
            setPreview(null);
        }
    }

    return (
        <div className="space-y-1">
            <Label>{label}</Label>
            {preview && (
                <img
                    src={preview}
                    alt="preview"
                    className="h-20 w-auto rounded-md object-cover mb-1"
                />
            )}
            <Input
                type="file"
                accept={accept}
                onChange={handleChange}
                disabled={disabled}
                aria-invalid={!!error}
                className={cn(
                    "cursor-pointer file:mr-3 file:text-sm file:font-medium",
                    error && "border-destructive"
                )}
            />
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
    );
}
