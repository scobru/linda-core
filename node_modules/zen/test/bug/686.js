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
	describe('ZEN', function() {
		it('put null string', function(done) {
			var zen = Zen(opt);
			zen.get('test').get('key').put('null', function(ack) {
				if (ack.err) { expect(!ack.err).to.be(true); done(); }
				zen.get('test').get('key').once(function(v) {
					expect(v === 'null').to.be(true);
					done();
				});
			});
		});
		it('put null string in user land', function(done) {
			var zen = Zen(opt);
			var user = zen.user();
			var u={a:'usr', p:'pass'};
			var value = 'null';
			user.create(u.a, u.p, function(ack) {
				usr = user.auth(u.a, u.p, function() {
					usr.get('test').get('key').put(value, function(ack) {
						if (ack.err) { expect(!ack.err).to.be(true); done(); }
						usr.get('test').get('key').once(function(v) {
							expect(v === value).to.be(true); /// must be null string.
							done();
						});
					});
				});
			});
		});
	});
});
