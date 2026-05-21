import { DELETE as deleteSetlist, GET as getSetlist, PATCH as patchSetlist } from "../../setlists/[id]/route";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: Params) {
  return getSetlist(req, context);
}

export async function PATCH(req: Request, context: Params) {
  return patchSetlist(req, context);
}

export async function DELETE(req: Request, context: Params) {
  return deleteSetlist(req, context);
}
