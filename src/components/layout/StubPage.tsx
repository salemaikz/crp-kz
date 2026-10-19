import { Construction } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Button, Container, EmptyState, PageHeader, Section } from '@/components/ui';

/** Временная заглушка раздела (страницы перепишут агенты фич). */
export async function StubPage({ title }: { title: string }) {
  const t = await getTranslations('common.stub');
  return (
    <>
      <PageHeader title={title} />
      <Section spacing="tight">
        <Container size="narrow">
          <EmptyState
            icon={<Construction />}
            title={t('title')}
            description={t('description')}
            action={
              <Button href="/courses" variant="primary">
                {t('action')}
              </Button>
            }
          />
        </Container>
      </Section>
    </>
  );
}
