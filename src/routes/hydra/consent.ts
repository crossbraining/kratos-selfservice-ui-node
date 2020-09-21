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

const createHydraSession = (requestedScope: string[] = [], context: Session) => {
  const verifiableAddresses = context.identity.verifiableAddresses || [];
  if (requestedScope.indexOf('email') === -1 || verifiableAddresses.length === 0) {
    return {};
  }

  return {
    // This data will be available when introspecting the token. Try to avoid sensitive information here,
    // unless you limit who can introspect tokens. (Therefore the scope-check above)
    // access_token: { foo: 'bar' },

    // This data will be available in the ID token.
    // Most services need email-addresses, so let's include that.
    idToken: {
      email: verifiableAddresses[0].value as Object // FIXME Small typescript workaround caused by a bug in Go-swagger
    }
  };
};

export const hydraGetConsent = (req: Request, res: Response, next: NextFunction) => {
  // Parses the URL query
  // The challenge is used to fetch information about the consent request from ORY Hydra.
  const challenge = req.query.consent_challenge;

  if (!challenge || !isString(challenge)) {
    next(new Error('Expected consent_challenge to be set.'));
    return;
  }

  hydraClient
    .getConsentRequest(challenge)
    // This will be called if the HTTP request was successful
    .then(({ body }) => {
      // If a user has granted this application the requested scope, hydra will tell us to not show the UI.
      if (body.skip) {
        // You can apply logic here, for example grant another scope, or do whatever...

        // Now it's time to grant the consent request. You could also deny the request if something went terribly wrong
        const acceptConsentRequest = new AcceptConsentRequest();

        // We can grant all scopes that have been requested - hydra already checked for us that no additional scopes
        // are requested accidentally.
        acceptConsentRequest.grantScope = body.requestedScope;

        // ORY Hydra checks if requested audiences are allowed by the client, so we can simply echo this.
        acceptConsentRequest.grantAccessTokenAudience = body.requestedAccessTokenAudience;

        // The session allows us to set session data for id and access tokens. Let's add the email if it is included.
        acceptConsentRequest.session = createHydraSession(body.requestedScope, body.context as Session);

        return hydraClient.acceptConsentRequest(challenge, acceptConsentRequest).then(({ body }) => {
          // All we need to do now is to redirect the user back to hydra!
          res.redirect(String(body.redirectTo));
        });
      }

      // If consent can't be skipped we MUST show the consent UI.
      res.render('consent', {
        csrfToken: req.csrfToken(),
        challenge: challenge,
        // We have a bunch of data available from the response, check out the API docs to find what these values mean
        // and what additional data you have available.
        requested_scope: body.requestedScope,
        user: body.subject,
        client: body.client
      });
    })
    // This will handle any error that happens when making HTTP calls to hydra
    .catch(next);
};

export const hydraPostConsent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // The challenge is now a hidden input field, so let's take it from the request body instead
    const challenge = req.body.challenge;

    // Let's see if the user decided to accept or reject the consent request..
    if (req.body.submit !== 'Allow access') {
      // Looks like the consent request was denied by the user
      const rejectConsentRequest = new RejectRequest();

      rejectConsentRequest.error = 'access_denied';
      rejectConsentRequest.errorDescription = 'The resource owner denied the request';

      const { body: consentBody } = await hydraClient.rejectConsentRequest(challenge, rejectConsentRequest);
      // All we need to do now is to redirect the browser back to hydra!
      res.redirect(String(consentBody.redirectTo));
    }

    let grantScope = req.body.grant_scope;
    if (!Array.isArray(grantScope)) {
      grantScope = [grantScope];
    }

    // Seems like the user authenticated! Let's tell hydra...
    const { body: consentBody } = await hydraClient.getConsentRequest(challenge);
    // This will be called if the HTTP request was successful
    const acceptConsentRequest = new AcceptConsentRequest();
    // We can grant all scopes that have been requested - hydra already checked for us that no additional scopes
    // are requested accidentally.
    acceptConsentRequest.grantScope = grantScope;

    // ORY Hydra checks if requested audiences are allowed by the client, so we can simply echo this.
    acceptConsentRequest.grantAccessTokenAudience = consentBody.requestedAccessTokenAudience;

    // This tells hydra to remember this consent request and allow the same client to request the same
    // scopes from the same user, without showing the UI, in the future.
    acceptConsentRequest.remember = Boolean(req.body.remember);

    // When this "remember" sesion expires, in seconds. Set this to 0 so it will never expire.
    acceptConsentRequest.rememberFor = 3600;

    // The session allows us to set session data for id and access tokens. Let's add the email if it is included.
    acceptConsentRequest.session = createHydraSession(consentBody.requestedScope, consentBody.context as Session);

    const { body: consentReqBody } = await hydraClient.acceptConsentRequest(challenge, acceptConsentRequest);
    res.redirect(String(consentReqBody.redirectTo));
    // This will handle any error that happens when making HTTP calls to hydra
  } catch (e) {
    next(e);
  }
};
