import { cn } from "@/lib/utils";

interface TabTitleProps {
  title: string;
  subtitle?: string;
  description?: string;
  className?: string;
}

export function TabTitle({
  title,
  subtitle,
  description,
  className,
}: TabTitleProps) {
  return (
    <div className={cn("space-y-1 mb-4", className)}>
      <div className="flex items-baseline gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <>
            <span className="text-muted-foreground">•</span>
            <span className="text-lg font-medium text-muted-foreground">
              {subtitle}
            </span>
          </>
        )}
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
