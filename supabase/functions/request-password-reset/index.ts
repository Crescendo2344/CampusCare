import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.117.3';
import {createAccountEmailHandler} from '../_shared/account-email.js';
// Public recovery is guarded by an exact account lookup before the email service is called.
Deno.serve(createAccountEmailHandler({createClient,env:name=>Deno.env.get(name),action:'reset'}));
