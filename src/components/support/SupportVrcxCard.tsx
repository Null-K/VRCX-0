import { CoffeeIcon, HeartIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { openExternalLink } from '@/services/entityMediaService';
import { links } from '@/shared/constants/link';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';

export function SupportVrcxCard({ className = '', showHeader = true }: any) {
    const { t } = useTranslation();

    return (
        <Card size="sm" className={cn(className)}>
            {showHeader ? (
                <CardHeader>
                    <CardTitle>{t('support_vrcx.title')}</CardTitle>
                    <CardDescription>
                        {t('support_vrcx.description')}
                    </CardDescription>
                </CardHeader>
            ) : null}
            <CardContent>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            openExternalLink(links.githubSponsors);
                        }}
                    >
                        <HeartIcon data-icon="inline-start" />
                        {t('support_vrcx.github_sponsors')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            openExternalLink(links.kofi);
                        }}
                    >
                        <CoffeeIcon data-icon="inline-start" />
                        {t('support_vrcx.kofi')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            openExternalLink(links.afdian);
                        }}
                    >
                        <HeartIcon data-icon="inline-start" />
                        爱发电
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
