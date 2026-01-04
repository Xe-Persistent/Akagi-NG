import type {FC} from 'react';
import {Input} from '@/components/ui/input';
import {SettingsItem} from "@/components/ui/settings-item";
import type {Paths, PathValue, Settings} from '@/hooks/useSettings';

interface ServerSectionProps {
    settings: Settings;
    updateSetting: <P extends Paths<Settings>>(path: readonly [...P], value: PathValue<Settings, P>) => void;
}

export const ServerSection: FC<ServerSectionProps> = ({settings, updateSetting}) => {
    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold border-b border-border pb-2">Server</h3>
            <div className="grid grid-cols-2 gap-4">
                <SettingsItem label="Host">
                    <Input
                        value={settings.server.host}
                        onChange={(e) => updateSetting(['server', 'host'], e.target.value)}
                    />
                </SettingsItem>
                <SettingsItem label="Port">
                    <Input
                        type="number"
                        value={settings.server.port}
                        onChange={(e) => updateSetting(['server', 'port'], parseInt(e.target.value))}
                    />
                </SettingsItem>
            </div>
        </div>
    );
};
