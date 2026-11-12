import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    seoTitle: z.string().optional(),
    keyword: z.string().optional(),
    description: z.string(),
    pubDate: z.coerce.date(),
    author: z.string().default('Oia Lens Team'),
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    category: z.string().default('Travel Guide'),
    readTime: z.string().default('4 min read'),
  }),
});

export const collections = { blog };
