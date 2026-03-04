import yaml from "js-yaml";

function convertAnnotation(input) {
  let output = input.text || "";

  const annotations = input.annotations || {};
  if (!output) {
    return output;
  }

  if (annotations.code) {
    output = `\`${output}\``;
  }

  if (annotations.bold) {
    output = `**${output}**`;
  }

  if (annotations.italic) {
    output = `_${output}_`;
  }

  if (annotations.strikethrough) {
    output = `~~${output}~~`;
  }

  if (annotations.underline) {
    output = `<u>${output}</u>`;
  }

  if (annotations.color && annotations.color !== "default") {
    output = `<span style="color:${annotations.color}">${output}</span>`;
  }

  if (annotations.link && annotations.link.url) {
    output = `[${output}](${annotations.link.url})`;
  }

  return output;
}

function richTextToText(parts = []) {
  return parts
    .map((part) => {
      if (part.type === "mention") {
        if (part.mention?.type === "user" && part.mention.user?.name) {
          return `@${part.mention.user.name}`;
        }
        if (part.mention?.type === "page" && part.mention.page?.id) {
          return `Page ${part.mention.page.id}`;
        }
        if (part.mention?.type === "database" && part.mention.database?.id) {
          return `Database ${part.mention.database.id}`;
        }
        return "";
      }

      if (part.type === "equation") {
        return `$${part.equation?.expression || ""}$`;
      }

      return convertAnnotation(part);
    })
    .join("");
}

function textFromList(list = []) {
  return list
    .map((item) => richTextToText(item.rich_text || []))
    .filter(Boolean)
    .join("");
}

function renderBlockChildren(blocks, context, depth = 0, listPrefix = "") {
  const lines = [];
  for (const child of blocks || []) {
    lines.push(...convertBlock(child, context, depth, listPrefix));
  }

  return lines.filter((line) => line !== null).join("\n");
}

function convertUnsupportedBlock(block) {
  const json = JSON.stringify(block, null, 2);
  return [
    `<!-- Unsupported block type: ${block.type} -->`,
    "```json",
    json,
    "```",
    "",
  ];
}

function tableRowToMdCells(cells = []) {
  return cells
    .map((cell) => richTextToText(cell || []))
    .map((value) => value.replace(/\|/g, "\\|") || "")
    .map((value) => value.trim());
}

function convertTable(block) {
  const rows = block.children || [];
  if (!rows.length) {
    return [""];
  }

  const markdownRows = rows
    .filter((row) => row.type === "table_row")
    .map((row) => tableRowToMdCells(row.table_row.cells));

  if (!markdownRows.length) {
    return [""];
  }

  const width = markdownRows[0].length;
  const header = markdownRows[0];
  const lines = [
    `| ${header.map((cell) => cell || " ").join(" | ")} |`,
    `| ${new Array(width).fill("---").join(" | ")} |`,
  ];

  for (const row of markdownRows.slice(1)) {
    const padded = row.concat(new Array(Math.max(0, width - row.length)).fill(" ")).slice(0, width);
    lines.push(`| ${padded.join(" | ")} |`);
  }

  lines.push("");
  return lines;
}

async function convertBlock(block, context, depth = 0, listPrefix = "") {
  const indent = "  ".repeat(depth);
  const lines = [];

  switch (block.type) {
    case "paragraph": {
      const text = richTextToText(block.paragraph.rich_text || []);
      if (text.trim()) {
        lines.push(indent + text);
      }
      lines.push("");
      break;
    }
    case "heading_1":
    case "heading_2":
    case "heading_3": {
      const level = block.type === "heading_1" ? 1 : block.type === "heading_2" ? 2 : 3;
      const heading = richTextToText(block[block.type].rich_text || []);
      if (heading.trim()) {
        lines.push(`${indent}${"#".repeat(level)} ${heading}`);
      }
      lines.push("");
      break;
    }
    case "quote": {
      const text = richTextToText(block.quote.rich_text || []);
      if (text.trim()) {
        lines.push(`${indent}> ${text}`);
      }
      lines.push("");
      break;
    }
    case "callout": {
      const icon = block.callout.icon?.type === "emoji" ? block.callout.icon.emoji : "";
      const text = richTextToText(block.callout.rich_text || []);
      lines.push(`${indent}> ${icon ? `${icon} ` : ""}${text}`);
      lines.push("");
      break;
    }
    case "bulleted_list_item":
    case "numbered_list_item": {
      const prefix = listPrefix || `${indent}- `;
      const text = richTextToText(block[block.type].rich_text || []);
      lines.push(prefix + text);
      if (Array.isArray(block.children)) {
        const childrenText = renderBlockChildren(block.children, context, depth + 1, `${"  ".repeat(depth + 1)}- `);
        if (childrenText) {
          lines.push(childrenText);
        }
      }
      lines.push("");
      break;
    }
    case "to_do": {
      const checked = block.to_do.checked ? "x" : " ";
      const text = richTextToText(block.to_do.rich_text || []);
      lines.push(`${indent}- [${checked}] ${text}`);
      lines.push("");
      break;
    }
    case "code": {
      const text = richTextToText(block.code.rich_text || []);
      const lang = block.code.language || "";
      lines.push(`${indent}\`\`\`${lang}`);
      if (text) {
        lines.push(text);
      }
      lines.push(`\`\`\``);
      lines.push("");
      break;
    }
    case "divider": {
      lines.push(`${indent}---`);
      lines.push("");
      break;
    }
    case "image": {
      const image = block.image;
      const source = image.type === "file" ? image.file.url : image.external?.url;
      const caption = richTextToText(image.caption || []);
      const linkText = caption || "Image";
      const local = await context.assetManager.resolveImageUrl(source);
      if (local) {
        lines.push(`${indent}![${linkText}](${local})`);
      }
      break;
    }
    case "file": {
      const file = block.file;
      const source = file.type === "file" ? file.file.url : file.external?.url;
      const name = file.caption && file.caption[0] ? richTextToText(file.caption || []) : "file";
      const local = await context.assetManager.resolveImageUrl(source);
      if (local) {
        lines.push(`${indent}[${name || "file"}](${local})`);
      }
      break;
    }
    case "pdf": {
      const name = block.pdf?.caption?.length
        ? richTextToText(block.pdf.caption || [])
        : "pdf";
      const source = block.pdf?.type === "file" ? block.pdf.file.url : block.pdf.external?.url;
      const local = await context.assetManager.resolveImageUrl(source);
      if (local) {
        lines.push(`${indent}[${name}](${local})`);
      }
      break;
    }
    case "bookmark": {
      const url = block.bookmark.url;
      const text = block.bookmark.caption?.length ? richTextToText(block.bookmark.caption) : url;
      lines.push(`${indent}[${text}](${url})`);
      lines.push("");
      break;
    }
    case "toggle": {
      const title = richTextToText(block.toggle.rich_text || []);
      lines.push(`${indent}<details>`);
      lines.push(`${indent}<summary>${title || "section"}</summary>`);
      if (Array.isArray(block.children)) {
        const nested = renderBlockChildren(block.children, context, depth + 1);
        if (nested) {
          lines.push("");
          lines.push(nested);
        }
      }
      lines.push(`${indent}</details>`);
      lines.push("");
      break;
    }
    case "child_page": {
      lines.push(`${indent}## ${richTextToText(block.child_page.title)}`);
      lines.push("");
      break;
    }
    case "child_database": {
      lines.push(`${indent}## ${richTextToText(block.child_database.title || [])}`);
      lines.push("");
      break;
    }
    case "table": {
      lines.push(...convertTable(block));
      break;
    }
    default: {
      lines.push(...convertUnsupportedBlock(block));
      break;
    }
  }

  if (block.children && !["bulleted_list_item", "numbered_list_item", "toggle"].includes(block.type)) {
    const nested = renderBlockChildren(block.children, context, depth + 1);
    if (nested) {
      lines.push(nested);
    }
  }

  return lines;
}

async function convertToMarkdown(blocks, context) {
  const lines = [];

  for (const block of blocks || []) {
    lines.push(...(await convertBlock(block, context)));
  }

  const content = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return `${content}\n`;
}

function frontmatterFromMeta(meta) {
  const yamlBody = yaml.dump(meta, { noRefs: true, lineWidth: 2000 });
  return `---\n${yamlBody}---`;
}

export { convertToMarkdown, frontmatterFromMeta, richTextToText };
