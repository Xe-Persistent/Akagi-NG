import React, {useEffect, useState} from 'react';
import {Button} from '@/components/ui/button.tsx';

interface SettingsPanelProps {
    open: boolean;
    onClose: () => void;
    apiBase: string;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({open, onClose, apiBase}) => {
    const [json, setJson] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            loadSettings();
        }
    }, [open]);

    const loadSettings = async () => {
        setError(null);
        setBusy(true);
        try {
            const res = await fetch(`${apiBase}/api/settings`, {method: 'GET'});
            const body = await res.json();
            if (!body?.ok) {
                throw new Error(body?.error || 'Failed to load settings');
            }
            setJson(JSON.stringify(body.data, null, 2));
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const saveSettings = async () => {
        setError(null);
        setBusy(true);
        try {
            let obj: unknown;
            try {
                obj = JSON.parse(json);
            } catch {
                throw new Error('Settings JSON is not valid JSON');
            }

            const res = await fetch(`${apiBase}/api/settings`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(obj),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body?.ok) {
                throw new Error(body?.error || `Save failed (${res.status})`);
            }

            alert('Settings saved. Please restart Akagi backend to apply.');
            onClose();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div
                className="w-full max-w-3xl rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-xl">
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                    <div>
                        <div className="text-lg font-semibold">Akagi Settings</div>
                        <div className="text-xs text-zinc-500">
                            Backend: {apiBase}
                        </div>
                    </div>
                    <Button variant="outline" onClick={onClose}>
                        Close
                    </Button>
                </div>

                <div className="p-4">
                    {error && (
                        <div
                            className="mb-3 p-2 rounded bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-200 text-sm">
                            {error}
                        </div>
                    )}

                    <textarea
                        className="w-full h-[420px] font-mono text-sm p-3 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-black"
                        value={json}
                        onChange={(e) => setJson(e.target.value)}
                        placeholder={busy ? 'Loading...' : '{\n  ...\n}'}
                        disabled={busy}
                    />

                    <div className="mt-3 flex items-center justify-end gap-2">
                        <Button variant="outline" onClick={loadSettings} disabled={busy}>
                            Reload
                        </Button>
                        <Button onClick={saveSettings} disabled={busy}>
                            Save
                        </Button>
                    </div>

                    <div className="mt-2 text-xs text-zinc-500">
                        Saving updates <code className="font-mono">settings/settings.json</code>. Restart backend to
                        apply.
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsPanel;