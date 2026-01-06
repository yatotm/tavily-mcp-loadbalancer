const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const UNICODE_NONCHARS = /[\uFFFE\uFFFF]/g;

const sanitizeText = (value: unknown, maxLength: number): string => {
  if (value === null || value === undefined) return '';
  let text = String(value);
  text = text.replace(CONTROL_CHARS, '').replace(UNICODE_NONCHARS, '');
  if (text.length > maxLength) {
    return `${text.slice(0, maxLength)}... [内容已截断]`;
  }
  return text;
};

export const formatResults = (response: any): string => {
  if (!response || typeof response !== 'object') {
    return 'Error: Invalid response format';
  }
  const output: string[] = [];
  if (response.answer) {
    output.push(`Answer: ${sanitizeText(response.answer, 2000)}`);
  }
  output.push('Detailed Results:');
  if (Array.isArray(response.results)) {
    response.results.forEach((result: any, index: number) => {
      output.push(`\n[${index + 1}] Title: ${sanitizeText(result.title, 200)}`);
      output.push(`URL: ${sanitizeText(result.url, 500)}`);
      output.push(`Content: ${sanitizeText(result.content, 3000)}`);
      if (result.raw_content) {
        output.push(`Raw Content: ${sanitizeText(result.raw_content, 2000)}`);
      }
      if (result.favicon) {
        output.push(`Favicon: ${sanitizeText(result.favicon, 500)}`);
      }
    });
  }
  if (response.images && Array.isArray(response.images) && response.images.length > 0) {
    output.push('\nImages:');
    response.images.forEach((image: any, index: number) => {
      if (typeof image === 'string') {
        output.push(`\n[${index + 1}] URL: ${sanitizeText(image, 500)}`);
      } else if (image && typeof image === 'object') {
        output.push(`\n[${index + 1}] URL: ${sanitizeText(image.url, 500)}`);
        if (image.description) {
          output.push(`   Description: ${sanitizeText(image.description, 200)}`);
        }
      }
    });
  }
  const joined = output.join('\n');
  return joined.length > 50000 ? `${joined.slice(0, 50000)}\n\n... [响应内容过长，已截断]` : joined;
};

export const formatCrawlResults = (response: any): string => {
  if (!response || typeof response !== 'object') {
    return 'Error: Invalid crawl response format';
  }
  const output: string[] = [];
  output.push('Crawl Results:');
  output.push(`Base URL: ${sanitizeText(response.base_url, 500)}`);
  output.push('\nCrawled Pages:');
  if (Array.isArray(response.results)) {
    response.results.forEach((page: any, index: number) => {
      output.push(`\n[${index + 1}] URL: ${sanitizeText(page.url, 500)}`);
      if (page.raw_content) {
        const contentPreview = sanitizeText(page.raw_content, 800);
        output.push(`Content: ${contentPreview}`);
      }
      if (page.favicon) {
        output.push(`Favicon: ${sanitizeText(page.favicon, 500)}`);
      }
    });
  }
  const joined = output.join('\n');
  return joined.length > 30000 ? `${joined.slice(0, 30000)}\n\n... [爬取结果过长，已截断]` : joined;
};

export const formatMapResults = (response: any): string => {
  if (!response || typeof response !== 'object') {
    return 'Error: Invalid map response format';
  }
  const output: string[] = [];
  output.push('Site Map Results:');
  output.push(`Base URL: ${sanitizeText(response.base_url, 500)}`);
  output.push('\nMapped Pages:');
  if (Array.isArray(response.results)) {
    response.results.forEach((page: any, index: number) => {
      const url = typeof page === 'string' ? page : page?.url || page;
      output.push(`\n[${index + 1}] URL: ${sanitizeText(url, 500)}`);
    });
  }
  const joined = output.join('\n');
  return joined.length > 20000 ? `${joined.slice(0, 20000)}\n\n... [站点地图过长，已截断]` : joined;
};

export const sanitizeForSse = (payload: string): string => {
  try {
    const jsonObj = JSON.parse(payload);
    if (jsonObj?.result?.content && Array.isArray(jsonObj.result.content)) {
      jsonObj.result.content = jsonObj.result.content.map((item: any) => {
        if (item?.text) {
          item.text = String(item.text)
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
            .replace(/[\uFEFF\uFFFE\uFFFF]/g, '')
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
        }
        return item;
      });
    }
    return JSON.stringify(jsonObj);
  } catch {
    return payload
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
      .replace(/[\uFEFF\uFFFE\uFFFF]/g, '')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }
};
