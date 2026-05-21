import { GET as getSetlists, POST as postSetlist } from "../setlists/route";

export async function GET(req: Request) {
  return getSetlists(req);
}

export async function POST(req: Request) {
  return postSetlist(req);
}
