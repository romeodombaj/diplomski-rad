import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/UI/input";
import { cn } from "@/lib/utils";

interface SearchInputProps {
    onSearch: (value: string) => void;
    isLoading?: boolean;
    placeholder?: string;
    className?: string;
    delay?: number;
    minLength?: number;
    active?: boolean;
}

export function SearchInput({
    onSearch,
    isLoading = false,
    placeholder = "Search...",
    className,
    delay = 350,
    minLength = 0,
    active = false,
}: SearchInputProps) {
    const [value, setValue] = useState("");
    const [isPending, setIsPending] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const onValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;

        setValue(value);

        if (value.length >= minLength || value.length === 0) {
            setIsPending(true);
            if (timer.current) clearTimeout(timer.current);

            timer.current = setTimeout(() => {
                onSearch(value);
                setIsPending(false);
            }, delay);
        }

        return () => {
            if (timer.current) clearTimeout(timer.current);
        };
    };

    return (
        <div className={cn("relative", className)}>
            <Input
                value={value}
                onChange={onValueChange}
                placeholder={placeholder}
                className={cn("pr-8", active && "border-primary")}
            />
            {(isPending || isLoading) && (
                <span className="absolute inset-y-0 right-2 flex items-center">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </span>
            )}
        </div>
    );
}
