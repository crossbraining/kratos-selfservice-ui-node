import { Request, Response } from 'express';
import config from '../config';
import jd from 'jwt-decode';

type UserRequest = Request & { user: any };

const authInfo = (req: UserRequest) => {
  if (config.securityMode === config.SECURITY_MODE_JWT) {
    const bearer = req.header('authorization');
    if (bearer) {
      // The header will be in format of `Bearer eyJhbGci...`. We therefore split at the whitespace to get the token
      // itself only.
      let token = bearer.split(' ')[1];
      return {
        raw: token,
        claims: req.user
      };
    }
  } else {
    const session = req.cookies.ory_kratos_session;
    if (session) {
      return {
        raw: session,
        claims: req.user
      };
    }
  }
};

export default (req: Request, res: Response) => {
  const interestingHeaders = req.rawHeaders.reduce(
    (p: string[], v: string, i) => (i % 2 ? p : [...p, `${v}: ${req.rawHeaders[i + 1]}`]),
    []
  );
  console.log(require('util').inspect(interestingHeaders, { depth: null, colors: true }));

  const ai = authInfo(req as UserRequest);
  res.render('dashboard', {
    session: ai?.claims.session,
    token: ai,
    headers: `GET ${req.path} HTTP/1.1

${interestingHeaders
  .filter((header: string) =>
    /User-Agent|Authorization|Content-Type|Host|Accept-Encoding|Accept-Language|Connection|X-Forwarded-For/.test(header)
  )
  .join('\n')}
...`
  });
};
