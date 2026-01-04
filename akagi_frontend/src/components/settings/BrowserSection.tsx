import type {FC} from 'react';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {CapsuleSwitch} from "@/components/ui/capsule-switch";
import {SettingsItem} from "@/components/ui/settings-item";
import type {Paths, PathValue, Settings} from '@/hooks/useSettings';

interface BrowserSectionProps {
    settings: Settings;
    updateSetting: <P extends Paths<Settings>>(path: readonly [...P], value: PathValue<Settings, P>) => void;
}

export const BrowserSection: FC<BrowserSectionProps> = ({settings, updateSetting}) => {
    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold border-b border-border pb-2">Browser</h3>

            <SettingsItem label="Browser">
                <Select
                    value={settings.browser.channel}
                    onValueChange={(val) => updateSetting(['browser', 'channel'], val)}
                >
                    <SelectTrigger>
                        <SelectValue/>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="chrome">Chrome</SelectItem>
                        <SelectItem value="msedge">Edge</SelectItem>
                        <SelectItem value="chromium">Chromium</SelectItem>
                    </SelectContent>
                </Select>
            </SettingsItem>

            <SettingsItem label="Window Size">
                <Select
                    value={settings.browser.window_size || "default"}
                    onValueChange={(val) => updateSetting(['browser', 'window_size'], val === "default" ? "" : val)}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Select resolution"/>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="default">Default</SelectItem>
                        <SelectItem value="maximized">Maximized</SelectItem>
                        <SelectItem value="1280,720">1280x720</SelectItem>
                        <SelectItem value="1920,1080">1920x1080</SelectItem>
                        <SelectItem value="2560,1440">2560x1440</SelectItem>
                        <SelectItem value="3840,2160">3840x2160</SelectItem>
                    </SelectContent>
                </Select>
            </SettingsItem>

            <SettingsItem label="Headless Mode">
                <CapsuleSwitch
                    checked={settings.browser.headless}
                    onCheckedChange={(val) => updateSetting(['browser', 'headless'], val)}
                    labelOn="Enabled"
                    labelOff="Disabled"
                />
            </SettingsItem>
        </div>
    );
};
