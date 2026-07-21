
import zenbase from '../../zen.js';
import '../../lib/store.js';
import '../../lib/rfs.js';
import fs from 'fs';
import fsrm from '../../lib/fsrm.js';
import xpect from '../expect.js';
var ZEN;
{
  var W = function(o){return new zenbase(o)};
  Object.setPrototypeOf(W, zenbase);
  W.prototype = zenbase.prototype;
  ZEN = W;
}
import serve from '../../lib/serve.js';
///// bug-783

describe('ZEN', function(){
	var root;
	{
		var env;
		if(typeof global !== 'undefined'){ env = global }
		if(typeof window !== 'undefined'){ env = window }
		root = env.window? env.window : global;
		try{ env.window && root.localStorage && root.localStorage.clear() }catch(e){}
		try{ localStorage.clear() }catch(e){}
		try{ indexedDB.deleteDatabase('radatatest') }catch(e){}
		try{ fs.unlinkSync('tmp/data.json') }catch(e){}
 		try{ fsrm('tmp/radatatest') }catch(e){}
		try{ var expect = global.expect = xpect }catch(e){}

		//root.Zen = root.Zen || load('../zen');
		if(root.Zen){
			root.Zen = root.Zen;
			root.Zen.TESTING = true;
		} else {
            root.Zen = ZEN;
            root.Zen.TESTING = true;
            Zen.serve = serve;
        }
	}(this);

	describe('erro zen', function(){
		it('verbose console.log debugging', function(done) {
			var zen = Zen({multicast:false, axe:false});
			var ref = zen.get('test').get('1');
			var vput = 'ZEN{}';
			ref.put(vput, function(ack, yay){ console.log('ACK: ', ack); /// must ack all
		          ref.once(function(v,k) { console.log('SALVOU k:%s, v:', k, v);
                            expect(v===vput).to.be(true);
			    done();
			});
	            });
		});
	} );
});
