# Curated FAQ Lists

This directory contains YAML files that define curated lists of FAQs. Each YAML file represents a curated collection that will be automatically processed and made available at `/lists/`.

## File Structure

Each YAML file should follow this structure:

```yaml
title: "Display Name for the List"
description: "Brief description of what this list covers"
faqs:
  - category/filename
  - category/filename
  - category/filename
```

## FAQ Reference Format

FAQs are referenced using the format `category/filename` (without the `.md` extension):
- `cra-itself/cra` refers to `_cache/faq/cra-itself/cra.md`
- `maintainers/should-i-worry` refers to `_cache/faq/maintainers/should-i-worry.md`

## Display Order

The order in which curated lists appear on the `/lists/` page is controlled by the `listOrder` array in the front matter of `src/lists.njk`. To reorder lists, modify that array.

## Adding a New List

1. Create a new `.yaml` file in this directory
2. Use a descriptive filename (becomes the URL slug)
3. Define the title, description, and FAQ references using the format above
4. Add the filename (without extension) to the `listOrder` array in `src/lists.njk` if you want it to appear in a specific position
5. The list will automatically appear at `/lists/filename/`

## URL Structure

- List index: `/lists/`
- Individual lists: `/lists/{filename}/`

## Notes

- Changes to YAML files require a site rebuild to take effect
- Invalid YAML files will be skipped with a warning
- FAQ references that don't exist will be filtered out silently