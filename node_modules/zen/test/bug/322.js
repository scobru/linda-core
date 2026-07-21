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
	}(this));

    var opt = { file: 'radatatest' };

	describe('API - map', function(){
		it('Save example data', function(done) {
			var zen = Zen(opt);
			zen.get('users').set({u:1});
			zen.get('users').set({u:2});
			zen.get('users').set({u:2});
			zen.get('users').map().on(function(user) { user.index = 'someIndex'; });
			setTimeout(function() { done(); }, 200);
		});
		it('Make sure the value "someIndex" not be saved in storage', function(done) {
			var zen = Zen(opt), values=[];
			zen.get('users').map().once(function(v) { values.push(v.index); });
			setTimeout(function() {
				expect(values.indexOf('someIndex')===-1).to.be(true);
				done();
			}, 200);
		});
	});
});
