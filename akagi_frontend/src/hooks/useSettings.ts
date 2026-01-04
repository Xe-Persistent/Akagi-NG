import {useCallback, useState} from 'react';

export async function fetchSettingsApi(apiBase: string): Promise<Settings> {
    const res = await fetch(`${apiBase}/api/settings`, {method: 'GET'});
    const body = await res.json();
    if (!body?.ok) {
        throw new Error(body?.error || 'Failed to load settings');
    }
    return body.data;
}

export async function saveSettingsApi(apiBase: string, settings: Settings): Promise<Settings> {
    const res = await fetch(`${apiBase}/api/settings`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(settings),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.ok) {
        throw new Error(body?.error || `Save failed (${res.status})`);
    }
    return settings; // Backend only returns { ok: true }, so we return local settings passed in.
}

export async function resetSettingsApi(apiBase: string): Promise<Settings> {
    const res = await fetch(`${apiBase}/api/settings/reset`, {method: 'POST'});
    const body = await res.json();
    if (!res.ok || !body?.ok) {
        throw new Error(body?.error || `Failed to restore settings (${res.status})`);
    }
    return body.data;
}

export interface Settings {
    log_level: string;
    majsoul_url: string;
    model: string;
    browser: {
        headless: boolean;
        channel: string;
        window_size: string;
    };
    server: {
        host: string;
        port: number;
    };
    model_config: {
        device: string;
        enable_amp: boolean;
        rule_based_agari_guard: boolean;
        ot: {
            online: boolean;
            server: string;
            api_key: string;
        }
    };
}

type Primitive = string | number | boolean | null | undefined | symbol | bigint;

export type Paths<T> = {
    [K in keyof T]:
    T[K] extends Primitive
        ? [K]
        : T[K] extends object
            ? [K] | [K, ...Paths<T[K]>]
            : [K];
}[keyof T];

export type PathValue<T, P extends readonly unknown[]> =
    P extends [infer K]
        ? K extends keyof T
            ? T[K]
            : never
        : P extends [infer K, ...infer R]
            ? K extends keyof T
                ? PathValue<T[K], R>
                : never
            : never;

function setByPath(
    root: Record<string, unknown>,
    path: readonly string[],
    value: unknown
) {
    let current: Record<string, unknown> = root;

    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        const next = current[key];

        if (typeof next !== 'object' || next === null) {
            current[key] = {};
        }

        current = current[key] as Record<string, unknown>;
    }

    current[path[path.length - 1]] = value;
}

export function useSettings(apiBase: string, initialSettings: Settings) {
    const [settings, setSettings] = useState<Settings | null>(initialSettings);
    const [originalSettings, setOriginalSettings] = useState<Settings | null>(initialSettings);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);


    const performAction = useCallback(async <T>(
        action: () => Promise<T>,
        onSuccess: (data: T) => void,
        errorMessagePrefix: string
    ) => {
        setError(null);
        setBusy(true);
        try {
            const result = await action();
            onSuccess(result);
        } catch (e) {
            console.error(`${errorMessagePrefix} error:`, e);
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }, []);

    const saveSettings = useCallback((onSuccess?: () => void) => {
        if (!settings) return;

        performAction(
            () => saveSettingsApi(apiBase, settings),
            () => {
                setOriginalSettings(JSON.parse(JSON.stringify(settings)));
                alert('Settings saved. Please restart Akagi backend to apply.');
                if (onSuccess) onSuccess();
            },
            'Save Settings'
        );
    }, [apiBase, settings, performAction]);

    const restoreDefaults = useCallback(() => {
        performAction(
            () => resetSettingsApi(apiBase),
            (data) => {
                setSettings(data);
                setOriginalSettings(JSON.parse(JSON.stringify(data)));
                alert('Settings restored to defaults. Please restart Akagi backend to apply.');
            },
            'Restore Defaults'
        );
    }, [apiBase, performAction]);

    const updateSetting = useCallback(<P extends Paths<Settings>>(
        path: readonly [...P],
        value: PathValue<Settings, P>
    ) => {
        setSettings(prev => {
            if (!prev) return null;

            const next = structuredClone(prev) as unknown as Record<string, unknown>;
            setByPath(next, path as readonly string[], value);

            return next as unknown as Settings;
        });
    }, []);

    const discardChanges = useCallback(() => {
        if (originalSettings) {
            setSettings(JSON.parse(JSON.stringify(originalSettings)));
        }
    }, [originalSettings]);

    return {
        settings,
        originalSettings,
        busy,
        error,
        updateSetting,
        saveSettings,

        restoreDefaults,
        discardChanges
    };
}
