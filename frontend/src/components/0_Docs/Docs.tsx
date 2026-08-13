import { useEffect, useState } from 'react';
import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/UI/button';
import { useTheme } from '@/context/ThemeContext';

export default function Docs() {
    const [spec, setSpec] = useState<object | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { theme } = useTheme();

    useEffect(() => {
        fetch('/openapi.json')
            .then(r => {
                if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
                return r.json();
            })
            .then(setSpec)
            .catch(e => setError(e.message));
    }, []);

    function handlePrint() {
        window.print();
    }

    function handleDownload() {
        if (!spec) return;
        const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'openapi.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    return (
        <div className={theme === 'dark' ? 'dark' : ''} style={{ minHeight: '100vh', background: theme === 'dark' ? '#0f172a' : '#fff' }}>
            {/* Header */}
            <div
                className="no-print"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 24px',
                    borderBottom: '1px solid #e2e8f0',
                    background: theme === 'dark' ? '#1e293b' : '#fff',
                    position: 'sticky',
                    top: 0,
                    zIndex: 50,
                }}
            >
                <span style={{ fontWeight: 600, fontSize: 16, color: theme === 'dark' ? '#f1f5f9' : '#0f172a' }}>
                    API Documentation
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="outline" size="sm" onClick={handleDownload} disabled={!spec}>
                        <Download className="size-4 mr-1" />
                        Download JSON
                    </Button>
                    <Button variant="outline" size="sm" onClick={handlePrint} disabled={!spec}>
                        <Printer className="size-4 mr-1" />
                        Print / Save as PDF
                    </Button>
                </div>
            </div>

            {/* Content */}
            {error ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#ef4444' }}>
                    <p style={{ fontWeight: 600 }}>Could not load API spec</p>
                    <p style={{ marginTop: 8, fontSize: 14 }}>{error}</p>
                    <p style={{ marginTop: 16, fontSize: 13, color: '#64748b' }}>
                        Run <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>npm run docs</code> in the project root to generate the spec.
                    </p>
                </div>
            ) : !spec ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
                    Loading...
                </div>
            ) : (
                <SwaggerUI spec={spec} docExpansion="list" defaultModelsExpandDepth={1} />
            )}

            <style>{`
                @media print {
                    .no-print { display: none !important; }
                    body { margin: 0; }
                }
                .swagger-ui .topbar { display: none; }
                .swagger-ui .info .title { font-size: 24px; }
            `}</style>
        </div>
    );
}
