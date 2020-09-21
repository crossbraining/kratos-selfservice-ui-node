import { NextFunction, Request, Response } from 'express';
import { PublicApi, Session } from '@oryd/kratos-client';
import { AdminApi as HydraAdminApi, AcceptConsentRequest, AcceptLoginRequest, RejectRequest } from '@oryd/hydra-client';
import crypto from 'crypto';

import config, { SECURITY_MODE_STANDALONE } from '../../config';
import { isString } from '../../helpers';

// Client for interacting with Hydra's Admin API
const hydraClient = new HydraAdminApi(config.hydra.admin);

// Client for interacting with Kratos' Public and Admin API
const kratosClient = new PublicApi(config.kratos.public);

const redirectToLogin = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.session) {
    next(Error('Unable to use express-session'));
    return;
  }

  // 3. Initiate login flow with ORY Kratos:
  //
  //   - `prompt=login` forces a new login from kratos regardless of browser sessions.
  //      This is important because we are letting Hydra handle sessions
  //   - `redirect_to` ensures that when we redirect back to this url,
  //      we will have both the initial ORY Hydra Login Challenge and the ORY Kratos Login Request ID in
  //      the URL query parameters.
  console.info(
    'Initiating ORY Kratos Login flow because neither a ORY Kratos Login Request nor a valid ORY Kratos Session was found.'
  );

  const state = crypto.randomBytes(48).toString('hex');
  req.session.hydraLoginState = state;
  req.session.save(error => {
    if (error) {
      next(error);
      return;
    }

    console.debug('Return to: ', {
      url: req.url,
      base: config.baseUrl,
      prot: `${req.protocol}://${req.headers.host}`
    });
    const baseUrl = config.baseUrl || `${req.protocol}://${req.headers.host}`;
    const returnTo = new URL(req.url, baseUrl);
    returnTo.searchParams.set('hydra_login_state', state);
    console.debug(`returnTo: "${returnTo.toString()}"`, returnTo);

    const redirectTo = new URL(config.kratos.browser + '/self-service/browser/flows/login', baseUrl);
    redirectTo.searchParams.set('refresh', 'true');
    redirectTo.searchParams.set('hydra', 'true');
    redirectTo.searchParams.set('return_to', returnTo.toString());

    console.debug(`redirectTo: "${redirectTo.toString()}"`, redirectTo);

    res.redirect(redirectTo.toString());
  });
};

export const hydraLogin = async (req: Request, res: Response, next: NextFunction) => {
  // The hydraChallenge represents the Hydra login_challenge query parameter.
  const hydraChallenge = req.query.login_challenge;

  if (config.securityMode !== SECURITY_MODE_STANDALONE) {
    next(new Error('Interaction with ORY Hydra only works in security standalone mode right now.'));
    return;
  }

  if (!hydraChallenge || !isString(hydraChallenge)) {
    const error = new Error(
      'ORY Hydra Login flow could not be completed because no ORY Hydra Login Challenge was found in the HTTP request.'
    );
    next(error);
    return;
  }

  // 1. Parse Hydra hydraChallenge from query params
  // The hydraChallenge is used to fetch information about the login kratosRequest from ORY Hydra.
  // Means we have just been redirected from Hydra, and are on the login page
  // We must check the hydra session to see if we can skip login

  // 2. Call Hydra and check the session of this user
  try {
    const { body } = await hydraClient.getLoginRequest(hydraChallenge);
    // If hydra was already able to authenticate the user, skip will be true and we do not need to re-authenticate
    // the user.
    if (body.skip) {
      // You can apply logic here, for example update the number of times the user logged in...
      // Now it's time to grant the login kratosRequest. You could also deny the kratosRequest if something went terribly wrong
      // (e.g. your arch-enemy logging in...)
      const acceptLoginRequest = new AcceptLoginRequest();
      acceptLoginRequest.subject = String(body.subject);

      console.debug('Accepting ORY Hydra Login Request because skip is true', acceptLoginRequest);

      const { body: b } = await hydraClient.acceptLoginRequest(hydraChallenge, acceptLoginRequest);
      // All we need to do now is to redirect the user back to hydra!
      res.redirect(String(b.redirectTo));
      return;
    }

    const hydraLoginState = req.query.hydra_login_state;
    if (!hydraLoginState || !isString(hydraLoginState)) {
      console.debug(
        'Redirecting to login page because hydra_login_state was not found in the HTTP URL query parameters.'
      );
      redirectToLogin(req, res, next);
      return;
    }

    const kratosSessionCookie = req.cookies.ory_kratos_session;
    if (!kratosSessionCookie) {
      // The state was set but we did not receive a session. Let's retry.
      console.debug('Redirecting to login page because no ORY Kratos session cookie was set.');
      redirectToLogin(req, res, next);
      return;
    }

    if (hydraLoginState !== req.session?.hydraLoginState) {
      // States mismatch, retry.
      console.debug('Redirecting to login page because login states do not match.');
      redirectToLogin(req, res, next);
      return;
    }

    // Figuring out the user
    req.headers['host'] = config.kratos.public.split('/')[2];
    const { body: whoamiBody } = await kratosClient
      // We need to know who the user is for hydra
      .whoami(req as { headers: { [name: string]: string } });
    // We need to get the email of the user. We don't want to do that via traits as
    // they are dynamic. They would be part of the PublicAPI. That's not true
    // for identity.addresses So let's get it via the AdmninAPI
    const subject = whoamiBody.identity.id;

    // User is authenticated, accept the LoginRequest and tell Hydra
    let acceptLoginRequest: AcceptLoginRequest = new AcceptLoginRequest();
    acceptLoginRequest.subject = subject;
    acceptLoginRequest.context = whoamiBody;

    const { body: loginBody } = await hydraClient.acceptLoginRequest(hydraChallenge, acceptLoginRequest);
    // All we need to do now is to redirect the user back to hydra!
    res.redirect(String(loginBody.redirectTo));
  } catch (e) {
    next(e);
  }
};
