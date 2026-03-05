import { Client } from "@notionhq/client";

class NotionSyncClient {
  constructor(token) {
    if (!token) {
      throw new Error("NOTION_TOKEN input is required");
    }
    this.client = new Client({ auth: token });
  }

  async resolveObjectById(id) {
    try {
      const page = await this.client.pages.retrieve({ page_id: id });
      return { kind: "page", object: page };
    } catch (error) {
      try {
        const database = await this.client.databases.retrieve({ database_id: id });
        return { kind: "database", object: database };
      } catch (dbError) {
        const details = dbError?.body?.message || dbError?.message || "Unknown error";
        throw new Error(`Unable to resolve Notion object ${id}: ${details}`);
      }
    }
  }

  async getDatabasePages(databaseId) {
    const pages = [];
    let cursor;
    while (true) {
      const response = await this.client.databases.query({
        database_id: databaseId,
        page_size: 100,
        start_cursor: cursor,
      });

      pages.push(...response.results);

      if (!response.has_more) {
        break;
      }
      cursor = response.next_cursor;
    }

    return pages;
  }

  async getPageById(pageId) {
    return this.client.pages.retrieve({ page_id: pageId });
  }

  static extractPageTitle(page) {
    if (!page || typeof page !== "object") {
      return "notion-page";
    }

    const properties = page.properties || {};
    const titleEntry = Object.values(properties).find((property) => property && property.type === "title");
    if (titleEntry && Array.isArray(titleEntry.title)) {
      const title = titleEntry.title.map((part) => part.plain_text || "").join("");
      if (title.trim()) {
        return title.trim();
      }
    }

    if (typeof page.name === "string" && page.name.trim()) {
      return page.name.trim();
    }

    return page.id || "notion-page";
  }
}

export { NotionSyncClient };
