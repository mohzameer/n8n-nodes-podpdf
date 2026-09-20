# n8n-nodes-podpdf

An [n8n](https://n8n.io) community node for [PodPDF](https://podpdf.com). It turns HTML, Markdown, URLs and templates into PDFs with the PodPDF API.

## Installation

Self-hosted n8n: go to **Settings → Community Nodes → Install**, enter `n8n-nodes-podpdf` and confirm. See n8n's [community node installation guide](https://docs.n8n.io/integrations/community-nodes/installation-and-management/gui-installation/).

## Credentials

1. Sign in at https://app.podpdf.com and open **Settings → API Keys** to create a key.
2. In n8n, create a **PodPDF API** credential and paste the key into **API Key**.

n8n checks the key by calling `GET https://api.podpdf.com/me`. Requests send it in the `X-API-Key` header.

PodPDF costs $0.01 per PDF and has no free plan. You need a paid plan or credit pack before calls succeed; without one the API returns `402 UPGRADE_REQUIRED`.

## Operations

| Resource | Operation | API call | Notes |
| --- | --- | --- | --- |
| PDF | **Generate PDF** | `POST /quickjob` | HTML, Markdown or a public HTTPS URL. Up to 25 pages and 30 seconds. |
| PDF | **Render Template** | `POST /templates/{id}/render` | Template ID (from **My templates** in the dashboard), a JSON **Data** object, and an optional **Filename**. |
| Job | **Start Long Job** | `POST /longjob` | HTML or Markdown, up to 100 pages. With **Wait for Completion** turned on, the node polls every 5 seconds for up to 3 minutes and then returns the download link. |
| Job | **Get Job** | `GET /jobs/{id}` | Status: `queued`, `processing`, `completed`, `partial_failed`, `failed` or `timeout`. |
| Job | **Get Download Link** | `GET /jobs/{id}/download` | Returns a new signed URL, valid for 1 hour. |

**Options** for Generate PDF and Start Long Job are Format (A4, Letter, Legal, A3, A5, Tabloid), Landscape, Margin (one value for all sides, such as `20mm`), Print Background, Scale (0.1–2) and Page Ranges (such as `1-3, 5`). The node sends only the options you add.

**Download File** (Generate PDF and Render Template; on by default) downloads the PDF and outputs it as the binary property `data` (`application/pdf`). The JSON response is kept, including `job_id`, `pages` and `download_url`. Turn it off if you only need the link.

## Errors

API errors appear as `CODE: message`, for example `INSUFFICIENT_CREDITS: …` or `QUICKJOB_TIMEOUT: …`. For a timeout, switch to **Start Long Job**. When **Continue On Fail** is on, the error goes into the item's `error` field and the workflow keeps running.

## Example workflow

**Manual Trigger → PodPDF (PDF → Generate PDF, Input Type: HTML, HTML: `<h1>Invoice {{ $json.number }}</h1>`) → Gmail (Send, attachment field `data`)**

## Resources

- API docs: https://apidocs.podpdf.com
- Website: https://podpdf.com
- Support: podpdfapp@gmail.com

## License

[MIT](LICENSE.md)
