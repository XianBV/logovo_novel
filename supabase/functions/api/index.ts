import { handleEdgeRequest } from '../../../server.js'

Deno.serve((request: Request) => handleEdgeRequest(request))

