import { Markdown as MarkdownExtension } from '@tiptap/markdown';
import { EditorContent, Extension, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import DOMPurify from 'dompurify';
import { Bold, Code, Italic, Link, List, ListOrdered, type LucideIcon, Quote, Strikethrough } from 'lucide-react';
import { marked } from 'marked';
import { fieldClass } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Only what Discord embeds render the same way: bold, italic, strike, code, links, lists, quotes.
// No headings or underline (markdown's __ is bold, Discord's is underline).

/** Stops Enter making new paragraphs, for one-line fields. */
const OneLine = Extension.create({
    name: 'oneLine',
    addKeyboardShortcuts: () => ({ Enter: () => true, 'Shift-Enter': () => true }),
});

export function MarkdownEditor({ value, onChange, singleLine = false }: { value: string; onChange: (markdown: string) => void; singleLine?: boolean }) {
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: false,
                codeBlock: false,
                horizontalRule: false,
                underline: false,
                link: { openOnClick: false },
                ...(singleLine && { bulletList: false, orderedList: false, listItem: false, blockquote: false, hardBreak: false }),
            }),
            MarkdownExtension,
            ...(singleLine ? [OneLine] : []),
        ],
        content: value,
        contentType: 'markdown',
        onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
        editorProps: { attributes: { class: cn(fieldClass, 'md py-2', singleLine ? 'min-h-9' : 'min-h-32') } },
    });

    const active = useEditorState({
        editor,
        selector: ({ editor: e }) => ({
            bold: e?.isActive('bold'),
            italic: e?.isActive('italic'),
            strike: e?.isActive('strike'),
            code: e?.isActive('code'),
            link: e?.isActive('link'),
            bulletList: e?.isActive('bulletList'),
            orderedList: e?.isActive('orderedList'),
            blockquote: e?.isActive('blockquote'),
        }),
    });

    if (!editor) return null;
    const chain = () => editor.chain().focus();

    const setLink = () => {
        if (editor.isActive('link')) return chain().unsetLink().run();
        const href = window.prompt('Link URL');
        if (href) chain().setLink({ href }).run();
    };

    const tools: [LucideIcon, string, boolean | undefined, () => void][] = [
        [Bold, 'Bold', active?.bold, () => chain().toggleBold().run()],
        [Italic, 'Italic', active?.italic, () => chain().toggleItalic().run()],
        [Strikethrough, 'Strikethrough', active?.strike, () => chain().toggleStrike().run()],
        [Code, 'Code', active?.code, () => chain().toggleCode().run()],
        [Link, 'Link', active?.link, setLink],
    ];
    if (!singleLine) {
        tools.push(
            [List, 'Bullet list', active?.bulletList, () => chain().toggleBulletList().run()],
            [ListOrdered, 'Numbered list', active?.orderedList, () => chain().toggleOrderedList().run()],
            [Quote, 'Quote', active?.blockquote, () => chain().toggleBlockquote().run()],
        );
    }

    return (
        <div className="min-w-0 flex-1">
            <div className="mb-1 flex gap-0.5">
                {tools.map(([Icon, label, on, run]) => (
                    <button
                        key={label}
                        type="button"
                        title={label}
                        onClick={run}
                        className={cn('cursor-pointer p-1 text-muted-foreground hover:text-foreground', on && 'text-primary hover:text-primary')}
                    >
                        <Icon className="size-3.5" />
                    </button>
                ))}
            </div>
            <EditorContent editor={editor} />
        </div>
    );
}

/** Renders stored markdown the way Discord would (single newlines are line breaks). */
export function Markdown({ text, inline = false, className }: { text: string; inline?: boolean; className?: string }) {
    const parse = inline ? marked.parseInline : marked.parse;
    const html = DOMPurify.sanitize(parse(text, { async: false, breaks: true }), { ADD_ATTR: ['target'] });
    const Tag = inline ? 'span' : 'div';
    return <Tag className={cn('md', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
