import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.117.3';
import {createAccountEmailHandler} from '../_shared/account-email.js';
// Expired confirmation links can be replaced only for an existing, unconfirmed registration.
Deno.serve(createAccountEmailHandler({createClient,env:name=>Deno.env.get(name),action:'resend'}));
