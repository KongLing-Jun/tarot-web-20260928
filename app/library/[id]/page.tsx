import type { Metadata } from 'next';
import { BRAND } from '@/lib/brand';
import { notFound } from 'next/navigation';
import { CardDetail } from '@/components/cards/CardDetail';
import { allCards } from '@/lib/tarot/cards';

type PageProps = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return allCards.map((card) => ({ id: card.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const card = allCards.find((card) => card.id === id);
  if (!card) notFound();
  return {
    title: `${card.nameCn} · 牌义 | ${BRAND.name}`,
    description: card.meaning.upright,
  };
}

export default async function CardMeaningPage({ params }: PageProps) {
  const { id } = await params;
  const card = allCards.find((card) => card.id === id);
  if (!card) notFound();
  return <CardDetail key={card.id} card={card} />;
}
