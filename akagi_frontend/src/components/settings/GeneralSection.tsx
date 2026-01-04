import type {FC} from 'react';
import {Input} from '@/components/ui/input';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {SettingsItem} from "@/components/ui/settings-item";
import type {Paths, PathValue, Settings} from '@/hooks/useSettings';

interface GeneralSectionProps {
    settings: Settings;
    updateSetting: <P extends Paths<Settings>>(path: readonly [...P], value: PathValue<Settings, P>) => void;
}

export const GeneralSection: FC<GeneralSectionProps> = ({settings, updateSetting}) => {
    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold border-b border-border pb-2">General</h3>

            <SettingsItem label="Log Level">
                <Select
                    value={settings.log_level}
                    onValueChange={(val) => updateSetting(['log_level'], val)}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Select level"/>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="TRACE">TRACE</SelectItem>
                        <SelectItem value="DEBUG">DEBUG</SelectItem>
                        <SelectItem value="INFO">INFO</SelectItem>
                        <SelectItem value="WARNING">WARNING</SelectItem>
                        <SelectItem value="ERROR">ERROR</SelectItem>
                    </SelectContent>
                </Select>
            </SettingsItem>

            <SettingsItem label="Majsoul URL">
                <Input
                    value={settings.majsoul_url}
                    onChange={(e) => updateSetting(['majsoul_url'], e.target.value)}
                />
            </SettingsItem>

            <SettingsItem label="Model">
                <Input
                    value={settings.model}
                    onChange={(e) => updateSetting(['model'], e.target.value)}
                />
            </SettingsItem>
        </div>
    );
};
